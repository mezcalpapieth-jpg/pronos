import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./support-tickets.js', import.meta.url), 'utf8');

test('support tickets endpoint lets users reply while a ticket is open', () => {
  assert.match(SOURCE, /action: 'reply'/);
  assert.match(SOURCE, /function replyTicket/);
  assert.match(SOURCE, /ticket_closed/);
  assert.match(SOURCE, /last_user_message_at = NOW\(\)/);
  assert.match(SOURCE, /notifySupportTicketUserReply/);
  assert.match(SOURCE, /WHERE id = \$1 AND LOWER\(username\) = LOWER\(\$2\)/);
  assert.match(SOURCE, /FOR UPDATE/);
});

test('support ticket replies preserve message authorship and attachments', () => {
  assert.match(SOURCE, /sender_type, sender_username, body, attachments/);
  assert.match(SOURCE, /VALUES \(\$1, 'user', \$2, \$3, \$4::jsonb\)/);
  assert.match(SOURCE, /normalizeSupportAttachments\(req\.body\?\.attachments\)/);
  assert.match(SOURCE, /serializeTicket\(result\.ticket, \[result\.message\]\)/);
});
