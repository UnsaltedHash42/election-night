'use strict';

const marketRace = document.getElementById('market-race');
marketRace.addEventListener('change', () => {
  const option = marketRace.selectedOptions[0];
  const frame = document.getElementById('market-race-frame');
  const query = new URLSearchParams({ market:option.value, theme:'dark', buttons:'false', fit:'true', height:'400' });
  frame.src = `https://embed.polymarket.com/market?${query}`;
  frame.title = `Polymarket: Democratic victory in ${option.textContent}`;
  const link = document.getElementById('market-race-link');
  link.href = `https://polymarket.com/event/${option.dataset.event}`;
  link.textContent = `Open ${option.textContent} market ↗`;
});
const reloadMarkets = () => {
  for (const frame of document.querySelectorAll('.market-grid iframe')) frame.src = frame.src;
};
document.getElementById('markets-refresh').addEventListener('click', () => {
  reloadMarkets();
  document.getElementById('markets-status').textContent = 'Refresh requested. Polymarket supplies these odds; they are not vote counts or race calls. Each question defines Yes and No.';
});
setInterval(() => {
  if (document.visibilityState === 'visible') reloadMarkets();
}, 300000);
