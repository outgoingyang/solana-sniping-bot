import axios from 'axios';

async function main() {
  // BONK mint as a well-known test subject
  const mint = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
  const res = await axios.get(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { timeout: 15000 });
  const s = res.data;
  console.log('score:', s.score, '| normalised:', s.score_normalised, '| lpLockedPct:', s.lpLockedPct);
  console.log('risks:', (s.risks ?? []).map((r: any) => `${r.name}(${r.level})`).join(', '));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
