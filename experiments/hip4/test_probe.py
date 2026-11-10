import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from eth_account import Account
from hyperliquid.utils.signing import recover_agent_or_user_from_l1_action

import probe


class ProbeTests(unittest.TestCase):
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
        self.assertEqual(probe.summarize(fills)["nonBuilderFeesUSDC"], "0.001")
        del fills[0]["builderFee"]
        self.assertEqual(probe.summarize(fills)["fillsWithoutBuilderFeeField"], 1)

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
