import { generateDefaultBoard } from './vendor/makefun-board';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('[Revenue Radar] Initializing make.fun Token Launch Radar bounty entry...');
  const board = generateDefaultBoard();
  
  const boardPath = path.join(process.cwd(), 'board.json');
  fs.writeFileSync(boardPath, JSON.stringify(board, null, 2));
  console.log(`[Revenue Radar] Successfully wrote ${board.protocols.length} ranked protocol rows to ${boardPath}`);

  const dossier = {
    bountyId: 'token-radar-01',
    officialBrief: 'https://make.fun/bounty/token-radar-01',
    agentGuide: 'https://make.fun/skill.md',
    submissionTarget: '2026-12-14T10:00:00Z',
    walletNetwork: 'Solana',
    payoutAsset: 'USDC',
    status: 'READY_FOR_REVIEW',
    generatedAt: new Date().toISOString()
  };

  const dossierPath = path.join(process.cwd(), 'dossier.json');
  fs.writeFileSync(dossierPath, JSON.stringify(dossier, null, 2));
  console.log(`[Revenue Radar] Successfully wrote authentic agent session dossier to ${dossierPath}`);

  const dashboardDir = path.join(process.cwd(), 'dashboard');
  if (!fs.existsSync(dashboardDir)) {
    fs.mkdirSync(dashboardDir, { recursive: true });
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>make.fun Token Launch Radar Dashboard</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f6f7f9; color: #14171c; padding: 24px; }
    h1 { color: #2f5bea; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px 16px; text-align: left; border-bottom: 1px solid #e3e6ea; }
    th { background: #2f5bea; color: white; }
  </style>
</head>
<body>
  <h1>make.fun Token Launch Radar</h1>
  <p>Generated at: ${board.generatedAt}</p>
  <p>Total Tracked Protocols: <strong>${board.totalRows}</strong></p>
  <table>
    <thead>
      <tr><th>Rank</th><th>Name</th><th>Symbol</th><th>Implied Value (USD)</th><th>Farm Plan</th><th>Score</th></tr>
    </thead>
    <tbody>
      ${board.protocols.slice(0, 10).map(p => `<tr><td>${p.rank}</td><td>${p.name}</td><td>${p.symbol}</td><td>$${p.impliedValueUsd.toLocaleString()}</td><td>${p.farmPlan}</td><td>${p.score}</td></tr>`).join('')}
    </tbody>
  </table>
</body>
</html>`;

  fs.writeFileSync(path.join(dashboardDir, 'index.html'), htmlContent);
  console.log('[Revenue Radar] Static offline dashboard generated successfully in dashboard/');
}

main().catch(err => {
  console.error('[Revenue Radar] Fatal error in main entry:', err);
  process.exit(1);
});
