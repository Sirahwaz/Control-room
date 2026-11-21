export interface ProtocolRow {
  rank: number;
  name: string;
  symbol: string;
  impliedValueUsd: number;
  farmPlan: string;
  score: number;
  launchDate: string;
  status: string;
}

export interface MakeFunBoard {
  generatedAt: string;
  totalRows: number;
  protocols: ProtocolRow[];
}

export function generateDefaultBoard(): MakeFunBoard {
  const protocols: ProtocolRow[] = [];
  for (let i = 1; i <= 100; i++) {
    protocols.push({
      rank: i,
      name: `Protocol Alpha ${i}`,
      symbol: `PALP${i}`,
      impliedValueUsd: Math.round(10000 + Math.sin(i) * 5000),
      farmPlan: i % 2 === 0 ? "Direct staking and liquidity pool LP emission farming" : "Task-based testnet engagement and community point accrual",
      score: Number((95 - i * 0.2).toFixed(2)),
      launchDate: "2026-11-20",
      status: "ACTIVE"
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    totalRows: protocols.length,
    protocols
  };
}
