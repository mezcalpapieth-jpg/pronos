import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from eth_account import Account
from hyperliquid.utils.signing import recover_agent_or_user_from_l1_action

import probe


class ProbeTests(unittest.TestCase):
    def test_embedded_funding_journals_spot_send_before_using_sponsor(self):
        sponsor, trader = Account.create(), Account.create()
        token_id = "0x" + "2" * 32
        with tempfile.TemporaryDirectory() as root, patch.object(probe, "LOCAL", Path(root)), \
             patch.object(probe, "wallet_info", side_effect=[probe.dec(31), probe.dec(0)]), \
             patch.object(probe, "now", return_value=4000), \
             patch.object(probe, "info", return_value={"tokens": [{"name": "USDC", "tokenId": token_id}]}), \
             patch.object(probe, "exchange", side_effect=TimeoutError("request timed out")) as send:
            key_path = Path(root) / "sponsor"
            key_path.write_text(sponsor.key.hex())
            key_path.chmod(0o600)
            journal = Path(root) / "fund" / "embedded-funding.json"

            def check_journal(wallet, action, mainnet):
                self.assertEqual(wallet.address, sponsor.address)
                self.assertFalse(mainnet)
                record = json.loads(journal.read_text())
                self.assertEqual(record["action"], action)
                self.assertNotIn(sponsor.key.hex(), journal.read_text())
                return {"r": "mocked"}

            with patch.object(probe, "sign_spot_transfer_action", side_effect=check_journal):
                with self.assertRaises(TimeoutError):
                    probe.fund_embedded("fund", sponsor.address, trader.address, probe.dec(30), key_path)
                with self.assertRaisesRegex(ValueError, "Funding slot used"):
                    probe.fund_embedded("fund", sponsor.address, trader.address, probe.dec(30), key_path)
            send.assert_called_once_with({"type": "spotSend", "destination": trader.address.lower(),
                                          "token": f"USDC:{token_id}", "amount": "30", "time": 4000},
                                         {"r": "mocked"}, 4000)

    def test_funding_requires_matching_private_sponsor_and_caps_amount(self):
        sponsor, trader, wrong = Account.create(), Account.create(), Account.create()
        with tempfile.TemporaryDirectory() as root, patch.object(probe, "LOCAL", Path(root)), \
             patch.object(probe, "info") as info, patch.object(probe, "exchange") as send:
            path = Path(root) / "sponsor"
            path.write_text(wrong.key.hex())
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "regular and private"):
                probe.fund_embedded("fund", sponsor.address, trader.address, probe.dec(30), path)
            path.chmod(0o600)
            with self.assertRaisesRegex(ValueError, "does not match"):
                probe.fund_embedded("fund", sponsor.address, trader.address, probe.dec(30), path)
            with self.assertRaisesRegex(ValueError, "up to 30"):
                probe.fund_embedded("fund", sponsor.address, trader.address, probe.dec("30.000001"), path)
            info.assert_not_called()
            send.assert_not_called()

    def test_spot_transfer_audit_requires_both_ledgers_and_expected_amount(self):
        source, destination = "0x" + "1" * 40, "0x" + "2" * 40
        tx = "0x" + "3" * 64
        delta = {"type": "spotTransfer", "token": "USDC", "amount": "30", "fee": "1",
                 "user": source, "destination": destination}
        transfer = {"hash": tx, "time": 4000, "delta": delta}
        other = {**transfer, "hash": "0x" + "4" * 64}
        meta = {"tokens": [{"name": "USDC", "tokenId": "0x" + "5" * 32}]}
        with patch.object(probe, "info", side_effect=[meta, [transfer, other], [transfer]]) as info, \
             patch.object(probe, "wallet_info", side_effect=[probe.dec(70), probe.dec(30)]), \
             patch.object(probe, "exchange") as send:
            report = probe.audit_transfer(source, destination, 3900, expected_amount=probe.dec(30))
            self.assertEqual(report["destinationFreeSpotUSDC"], "30")
            self.assertEqual([t["hash"] for t in report["confirmedTransfers"]], [tx])
            self.assertEqual(report["confirmedTransfers"][0]["amountUSDC"], "30")
            self.assertTrue(all(not call.kwargs.get("mainnet") for call in info.call_args_list))
            send.assert_not_called()
        with patch.object(probe, "info", side_effect=[meta, [transfer], [{**transfer, "delta": {**delta, "amount": "29"}}]]), \
             patch.object(probe, "wallet_info", return_value=probe.dec(0)):
            self.assertEqual(probe.audit_transfer(source, destination, 3900, tx)["confirmedTransfers"], [])

    def test_embedded_order_matches_ioc_fill_and_observed_builder_credit(self):
        trader, builder = "0x" + "1" * 40, "0x" + "2" * 40
        cloid = "0x" + "3" * 32
        fill_hash = "0x" + "4" * 64
        order = {"coin": "#265930", "oid": 3, "side": "B", "tif": "Ioc", "cloid": cloid, "timestamp": 4000}
        status = {"status": "order", "order": {"status": "filled", "order": order, "statusTimestamp": 4001}}
        fill = {"oid": 3, "tid": 4, "coin": "#265930", "side": "B", "hash": fill_hash, "sz": "22",
                "px": "0.505", "fee": "0.028775", "builderFee": "0.027775", "feeToken": "USDC"}
        baseline = {"network": "Testnet", "builder": builder, "observedAtMs": 3900,
                    "rewards": {"builderRewards": "0", "unclaimedRewards": "0", "tokenToState": []}}
        after = {"builderRewards": "0.027775", "unclaimedRewards": "0.027775", "tokenToState": []}
        with patch.object(probe, "info", side_effect=[status, [fill], 250]), \
             patch.object(probe, "rewards", return_value=after):
            report = probe.audit_order(trader, builder, cloid, 26593, 0, "buy", 4000, baseline)
        self.assertEqual(report["orderStatus"], "filled")
        self.assertEqual(report["fillTxHashes"], [fill_hash])
        self.assertEqual(report["notionalUSDC"], "11.11")
        self.assertTrue(report["isIoc"])
        self.assertTrue(report["builderFeeMatches25Bps"])
        self.assertTrue(report["builderCreditMatches25BpsFill"])
        with patch.object(probe, "info", side_effect=[status, [fill], 250]), \
             patch.object(probe, "rewards", return_value=baseline["rewards"]):
            self.assertFalse(probe.audit_order(trader, builder, cloid, 26593, 0, "buy", 4000, baseline)
                             ["builderCreditMatches25BpsFill"])

    def test_withdrawal_audit_matches_bridge_and_usdc_logs_plus_balance_change(self):
        trader = "0x" + "1" * 40
        tx = "0x" + "2" * 64
        recipient = "0x" + trader[2:].rjust(64, "0")
        sender = "0x" + probe.CORE_DEPOSIT_WALLET[2:].rjust(64, "0")
        baseline = {"network": "Testnet", "chainId": 998, "trader": trader, "usdcToken": probe.HYPEREVM_USDC,
                    "block": 500, "coreFreeUSDC": "12", "evmUSDCUnits": 1_000_000}
        after = {**baseline, "block": 560, "coreFreeUSDC": "2", "evmUSDCUnits": 11_000_000}
        event = {"transactionHash": tx, "blockNumber": hex(552), "data": hex(10_000_000)}
        withdraw = {**event, "address": probe.CORE_DEPOSIT_WALLET, "topics": [probe.WITHDRAW_TOPIC, recipient]}
        transfer = {**event, "address": probe.HYPEREVM_USDC, "topics": [probe.TRANSFER_TOPIC, sender, recipient]}
        with patch.object(probe, "withdrawal_state", return_value=after), \
             patch.object(probe, "evm_rpc", side_effect=[[], [withdraw, transfer]]) as rpc:
            result = probe.audit_withdrawal(trader, probe.dec(10), baseline)
        self.assertTrue(result["withdrawalConfirmed"])
        self.assertEqual(result["matchingCredits"][0]["hash"], tx)
        self.assertEqual(result["evmCreditUSDC"], "10")
        self.assertEqual([(c.args[1]["fromBlock"], c.args[1]["toBlock"]) for c in rpc.call_args_list],
                         [(hex(501), hex(550)), (hex(551), hex(560))])
        with patch.object(probe, "withdrawal_state", return_value=after), \
             patch.object(probe, "evm_rpc", return_value={"status": "0x1", "logs": [withdraw, transfer]}) as rpc:
            self.assertTrue(probe.audit_withdrawal(trader, probe.dec(10), baseline, tx)["withdrawalConfirmed"])
            rpc.assert_called_once_with("eth_getTransactionReceipt", tx)
        for status, logs in [("0x0", [withdraw, transfer]),
                             ("0x1", [withdraw, {**transfer, "transactionHash": "0x" + "3" * 64}]),
                             ("0x1", [withdraw, {**transfer, "removed": True}])]:
            with patch.object(probe, "withdrawal_state", return_value=after), \
                 patch.object(probe, "evm_rpc", return_value={"status": status, "logs": logs}):
                self.assertFalse(probe.audit_withdrawal(trader, probe.dec(10), baseline, tx)["withdrawalConfirmed"])
        with patch.object(probe, "withdrawal_state", return_value={**after, "evmUSDCUnits": 10_000_000}), \
             patch.object(probe, "evm_rpc", return_value={"status": "0x1", "logs": [withdraw, transfer]}):
            self.assertFalse(probe.audit_withdrawal(trader, probe.dec(10), baseline, tx)["withdrawalConfirmed"])

    def test_withdrawal_baseline_fails_closed_on_wrong_chain(self):
        with patch.object(probe, "evm_rpc", return_value="0x3e7") as rpc, patch.object(probe, "wallet_info") as wallet:
            with self.assertRaisesRegex(ValueError, "chain 998"):
                probe.withdrawal_state("0x" + "1" * 40)
            rpc.assert_called_once_with("eth_chainId")
            wallet.assert_not_called()

    def test_withdrawal_baseline_reads_usdc_at_the_captured_block(self):
        trader = "0x" + "1" * 40
        with patch.object(probe, "evm_rpc", side_effect=["0x3e6", "0x100", hex(1_000_000)]) as rpc, \
             patch.object(probe, "wallet_info", return_value=probe.dec(5)):
            result = probe.withdrawal_state(trader)
        self.assertEqual((result["block"], result["evmUSDCUnits"], result["coreFreeUSDC"]), (256, 1_000_000, "5"))
        self.assertEqual(rpc.call_args.args, ("eth_call", {
            "to": probe.HYPEREVM_USDC, "data": "0x70a08231" + trader[2:].rjust(64, "0"),
        }, "0x100"))

    def test_testnet_order_signature_cannot_recover_signer_on_mainnet(self):
        signer = Account.create()
        action = probe.order_wire(26593, 1, "buy", probe.dec(22), probe.dec("0.505"),
                                  Account.create().address.lower(), "0x" + "1" * 32)
        self.assertEqual(action["orders"][0]["a"], 100265931)
        self.assertEqual(action["builder"]["f"], 250)
        signature = probe.sign_l1_action(signer, action, None, 1000, 16000, False)
        args = (action, signature, None, 1000, 16000)
        self.assertEqual(recover_agent_or_user_from_l1_action(*args, False), signer.address)
        self.assertNotEqual(recover_agent_or_user_from_l1_action(*args, True), signer.address)

    def test_public_fee_samples_keep_builder_and_total_fees_separate(self):
        fills = [{"sz": "22", "px": "0.505", "fee": "0.0001111", "builderFee": "0.0001111", "feeToken": "USDC"},
                 {"sz": "23", "px": "0.45", "fee": "0.0035875", "builderFee": "0.0025875", "feeToken": "USDC"}]
        self.assertEqual(probe.summarize(fills[:1])["effectiveBuilderBps"], "0.1")
        self.assertEqual(probe.summarize(fills[1:])["effectiveBuilderBps"], "2.5")
        self.assertFalse(probe.summarize(fills)["builderFeeMatches25Bps"])
        self.assertEqual(probe.summarize(fills)["nonBuilderFeesUSDC"], "0.001")
        del fills[0]["builderFee"]
        self.assertEqual(probe.summarize(fills)["fillsWithoutBuilderFeeField"], 1)

    def test_liquidity_walks_multiple_levels_and_applies_the_fee_to_each_band(self):
        book = {"time": 1000, "levels": [
            [{"px": "0.48", "sz": "20"}, {"px": "0.49", "sz": "10"}, {"px": "0.46", "sz": "25"}],
            [{"px": "0.51", "sz": "6"}, {"px": "0.52", "sz": "10"}, {"px": "0.54", "sz": "4"}],
        ]}
        report = probe.liquidity_snapshot(book, [12, 25], probe.dec(25), None, 1200)
        self.assertEqual((report["status"], report["referencePrice"], report["spreadPoints"]), ("two_sided", "0.5", "2"))
        buy, sell = report["buy"], report["sell"]
        self.assertEqual(buy["depthWithinPoints"]["2"]["visibleShares"], "6")
        self.assertEqual(sell["depthWithinPoints"]["2"]["visibleShares"], "10")
        self.assertEqual(sell["depthWithinPoints"]["5"]["visibleShares"], "55")
        self.assertEqual(buy["sizeEstimates"][0]["vwap"], "0.515")
        self.assertEqual(buy["sizeEstimates"][0]["costVsReferencePoints"], "1.62875")
        self.assertEqual(buy["sizeEstimates"][1]["coveragePct"], "80")
        self.assertEqual(sell["sizeEstimates"][0]["quoteAfterAssumedFees"], "5.84535")

    def test_liquidity_keeps_missing_and_stale_depth_distinct(self):
        book = {"time": 1000, "levels": [[], [{"px": "0.52", "sz": "20"}]]}
        report = probe.liquidity_snapshot(book, [10], probe.dec(0), None, 1200)
        self.assertEqual(report["status"], "one_sided")
        self.assertIsNone(report["referencePrice"])
        self.assertEqual(report["sell"]["sizeEstimates"][0]["coveragePct"], "0")
        self.assertEqual(report["buy"]["depthWithinPoints"], {})
        independent = probe.liquidity_snapshot(book, [10], probe.dec(0), probe.dec("0.5"), 1200)
        self.assertEqual(independent["buy"]["depthWithinPoints"]["2"]["visibleShares"], "20")
        stale = probe.liquidity_snapshot(book, [10], probe.dec(0), None, 16_000)
        self.assertEqual(stale["status"], "stale")
        self.assertNotIn("buy", stale)

    def test_fill_lookup_filters_oid_and_rejects_duplicate_or_wrong_side(self):
        record = {"trader": "trader", "cloid": "client", "nonce": 4000, "coin": "#265930", "direction": "buy"}
        status = {"status": "order", "order": {"status": "filled", "order": {"coin": "#265930", "oid": 3}}}
        fill = {"oid": 3, "tid": 4, "coin": "#265930", "side": "B"}
        with patch.object(probe, "info", side_effect=[status, [dict(fill, oid=1), fill]]):
            self.assertEqual(probe.order_fills(record)["fills"], [fill])
        with patch.object(probe, "info", side_effect=[status, [fill, fill]]), self.assertRaisesRegex(ValueError, "Duplicate"):
            probe.order_fills(record)
        with patch.object(probe, "info", side_effect=[status, [dict(fill, side="A")]]), self.assertRaisesRegex(ValueError, "direction"):
            probe.order_fills(record)

    def test_audit_requires_both_legs_and_actual_usdc_builder_credit(self):
        empty = {"builderRewards": "0.0", "unclaimedRewards": "0.0", "tokenToState": []}
        fill = {"sz": "22", "px": "0.505", "fee": "0.027775", "builderFee": "0.027775", "feeToken": "USDC"}
        filled = {"orderStatus": "filled", "fills": [fill]}
        after = {"builderRewards": "0.05555", "unclaimedRewards": "0.05555", "tokenToState": []}
        with tempfile.TemporaryDirectory() as root, patch.object(probe, "LOCAL", Path(root)):
            folder = Path(root) / "probe"
            folder.mkdir()
            journal = {"rewardsBefore": empty, "trader": "t", "builder": "b", "coin": "#1"}
            (folder / "buy.json").write_text(json.dumps(journal))
            with patch.object(probe, "order_fills", return_value=filled), patch.object(probe, "rewards", return_value=after):
                self.assertFalse(probe.audit("probe")["bothSidesCreditedAndFlat"])
            (folder / "sell.json").write_text(json.dumps(journal))
            with patch.object(probe, "order_fills", return_value=filled), patch.object(probe, "rewards", return_value=after):
                self.assertTrue(probe.audit("probe")["bothSidesCreditedAndFlat"])
            with patch.object(probe, "order_fills", return_value=filled), patch.object(probe, "rewards", return_value=empty):
                self.assertFalse(probe.audit("probe")["bothSidesCreditedAndFlat"])

    def test_unfunded_builder_cannot_submit_order(self):
        trader, builder = Account.create(), Account.create()
        state = {"abstraction": "default", "perpsUSDCAccountValue": "0.0"}
        with tempfile.TemporaryDirectory() as root, patch.object(probe, "LOCAL", Path(root)), \
             patch.object(probe, "accounts", return_value=(trader, builder)), \
             patch.object(probe, "builder_state", return_value=state), patch.object(probe, "exchange") as send:
            with self.assertRaisesRegex(ValueError, "100 mock USDC"):
                probe.submit("probe", "buy", 26593, 0, probe.dec("0.505"), probe.dec(22), probe.dec("0.49"))
            send.assert_not_called()
            self.assertFalse((Path(root) / "probe").exists())

    def test_journal_cannot_be_overwritten_after_uncertain_submission(self):
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "buy.json"
            probe.save_new(path, {"cloid": "original"})
            with self.assertRaises(FileExistsError):
                probe.save_new(path, {"cloid": "new"})
            self.assertEqual(json.loads(path.read_text())["cloid"], "original")


if __name__ == "__main__":
    unittest.main()
