// ============================================================
//  WALLET PAGE
//
//  Shows the balance, lets a student add money, and lists
//  every payment they have made.
//
//  Adding money calls the top_up_wallet() database function.
//  The browser is never allowed to change a balance directly,
//  because there is no update rule on the wallets table.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, busy, showLoading, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { taka, formatDate, safe } from './format.js';

const balanceLabel = document.getElementById('balance');
const historyBox = document.getElementById('history');
const form = document.getElementById('topup-form');
const topupBtn = document.getElementById('topup-btn');

let me = null;

start();

async function start() {
  renderTopbar('student-wallet.html');
  renderPageHero({
    eyebrow: 'Student',
    title: 'My wallet',
    subtitle: 'Add money once, then join batches in one tap.',
  });
  setupReveal();

  me = await requireRole('student');
  if (!me) return;

  await loadBalance();
  await loadHistory();
}

async function loadBalance() {
  const { data } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', me.id)
    .maybeSingle();

  balanceLabel.textContent = taka(data?.balance || 0);
}

async function loadHistory() {
  showLoading(historyBox, 2);

  const { data: rows } = await supabase
    .from('transactions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (!rows || rows.length === 0) {
    showEmpty(
      historyBox,
      'wallet',
      'No payments yet',
      'Add money above, then join your first batch.'
    );
    return;
  }

  historyBox.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Date</th><th>What happened</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;
}

function rowHtml(row) {
  // Money in is green with a +, money out is red with a -.
  const isIn = row.amount > 0;
  const amountText = (isIn ? '+' : '−') + taka(Math.abs(row.amount));
  const colour = isIn ? 'text-success' : 'text-danger';

  return `
    <tr>
      <td class="muted nowrap">${formatDate(row.created_at)}</td>
      <td>${safe(row.note || row.kind)}</td>
      <td class="strong money nowrap ${colour}">${amountText}</td>
    </tr>`;
}

// ---- Add money ---------------------------------------------
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(topupBtn, true, 'Adding money...');

  const amount = Number(
    document.querySelector('input[name="amount"]:checked').value
  );
  const method = document.getElementById('method').value;

  // In a real site the payment would be confirmed with bKash
  // on a server first. Here we go straight to the database.
  const { error } = await supabase.rpc('top_up_wallet', { amount: amount });

  if (error) {
    toast(error.message, 'error');
    busy(topupBtn, false);
    return;
  }

  toast(taka(amount) + ' added using ' + method + '.', 'success');
  busy(topupBtn, false);

  await loadBalance();
  await loadHistory();
});
