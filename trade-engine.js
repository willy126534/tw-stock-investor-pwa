#!/usr/bin/env node
/**
 * 台股自動交易引擎 - OWL Investor
 * 
 * 交易時段：週一至週五 09:00-13:30 (UTC+8) = 01:00-05:30 UTC
 * 策略：根據預設策略模板自動買入/賣出，模擬真實投資
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const STATE_FILE = path.join(__dirname, 'trade-state.json');
const LOG_FILE = path.join(__dirname, 'trade-log.jsonl');
const INITIAL_CASH = 1000000;

// ============ 股票池 ============
const STOCK_POOL = [
  { code: '2330', name: '台積電',  sector: '半導體',   basePrice: 985.00 },
  { code: '2317', name: '鴻海',    sector: '電子代工', basePrice: 172.50 },
  { code: '2454', name: '聯發科',  sector: '半導體',   basePrice: 1380.00 },
  { code: '2382', name: '廣達',    sector: 'AI伺服器', basePrice: 285.00 },
  { code: '3231', name: '緯創',    sector: 'AI伺服器', basePrice: 118.00 },
  { code: '2308', name: '台達電',  sector: '電子零組件', basePrice: 412.00 },
  { code: '2881', name: '富邦金',  sector: '金融',     basePrice: 68.50 },
  { code: '2882', name: '國泰金',  sector: '金融',     basePrice: 62.30 },
  { code: '2412', name: '中華電',  sector: '電信',     basePrice: 125.00 },
  { code: '3045', name: '台灣大',  sector: '電信',     basePrice: 108.00 },
  { code: '1301', name: '台塑',    sector: '傳產',     basePrice: 82.30 },
  { code: '3008', name: '大立光',  sector: '光學',     basePrice: 2450.00 },
  { code: '3034', name: '聯詠',    sector: 'IC設計',   basePrice: 185.00 },
  { code: '2379', name: '瑞昱',    sector: 'IC設計',   basePrice: 520.00 },
  { code: '3665', name: '貿聯-KY', sector: '電動車',   basePrice: 485.00 },
  { code: '1402', name: '遠東新',  sector: '傳產',     basePrice: 32.50 },
  { code: '1101', name: '台泥',    sector: '傳產',     basePrice: 28.80 },
  { code: '2886', name: '兆豐金',  sector: '金融',     basePrice: 41.20 },
  { code: '2303', name: '聯電',    sector: '半導體',   basePrice: 48.50 },
  { code: '2357', name: '華碩',    sector: 'PC',       basePrice: 620.00 },
];

// ============ 策略模板 ============
const STRATEGIES = [
  {
    title: '半導體逢低布局',
    sector: '半導體',
    action: 'buy',
    reason: 'AI產業長期看好，半導體族群回檔為進場良機。分批買入台積電、聯發科。',
    maxPosition: 0.15, // 單一持股不超過15%
    stopLoss: 0.95,
  },
  {
    title: 'AI伺服器追強',
    sector: 'AI伺服器',
    action: 'buy',
    reason: 'AI伺服器需求持續升溫，廣達、緯創量價齊揚。',
    maxPosition: 0.10,
    stopLoss: 0.93,
  },
  {
    title: '金融股防禦配置',
    sector: '金融',
    action: 'buy',
    reason: '市場不確定性升高，金融股配息穩定，適合防禦配置。',
    maxPosition: 0.10,
    stopLoss: 0.97,
  },
  {
    title: '電信股穩健布局',
    sector: '電信',
    action: 'buy',
    reason: '電信股現金流穩定，殖利率高，適合長期持有。',
    maxPosition: 0.08,
    stopLoss: 0.97,
  },
  {
    title: 'IC設計反彈契機',
    sector: 'IC設計',
    action: 'buy',
    reason: 'IC設計族群跌幅已深，技術面出現背離，短線反彈可期。',
    maxPosition: 0.08,
    stopLoss: 0.92,
  },
  {
    title: '獲利了結',
    sector: 'any',
    action: 'sell',
    reason: '部分持股已達獲利目標，執行獲利了結。',
    profitTarget: 0.05,
  },
  {
    title: '停損出場',
    sector: 'any',
    action: 'sell',
    reason: '持股觸及停損價，執行停損。',
    stopLoss: 0.95,
  },
  {
    title: '傳產輪動機會',
    sector: '傳產',
    action: 'buy',
    reason: '資金從電子輪動至傳產，基礎建設題材受惠。',
    maxPosition: 0.05,
    stopLoss: 0.95,
  },
  {
    title: '電動車供應鏈',
    sector: '電動車',
    action: 'buy',
    reason: '特斯拉財報優於預期，帶動台廠供應鏈。',
    maxPosition: 0.05,
    stopLoss: 0.93,
  },
  {
    title: 'PC族群旺季',
    sector: 'PC',
    action: 'buy',
    reason: 'PC傳統旺季來臨，華碩等品牌廠受惠。',
    maxPosition: 0.08,
    stopLoss: 0.94,
  },
];

// ============ 狀態管理 ============
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch (e) {}
  return {
    cash: INITIAL_CASH,
    holdings: [],
    trades: [],
    navHistory: [{ date: todayStr(), value: INITIAL_CASH }],
    strategies: [],
    lastTradeDate: null,
    totalTrades: 0,
  };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function logTrade(entry) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

// ============ 工具函數 ============
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function nowTimeStr() {
  return new Date().toLocaleTimeString('zh-TW', { hour12: false });
}

function fmt(n) {
  return 'NT$ ' + n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

function fmtPrice(n) {
  return n.toFixed(2);
}

// ============ 模擬價格（隨機遊走）============
const priceCache = {};

function getSimulatedPrice(stock) {
  const key = stock.code;
  if (!priceCache[key]) {
    priceCache[key] = { price: stock.basePrice, trend: 0 };
  }
  const p = priceCache[key];
  // 隨機遊走 + 趨勢回復
  const drift = -p.trend * 0.1; // 趨勢回復
  const shock = (Math.random() - 0.48) * 0.015; // 輕微正偏
  p.trend = p.trend * 0.95 + shock;
  p.price = Math.max(stock.basePrice * 0.7, Math.min(stock.basePrice * 1.3, p.price * (1 + drift + shock)));
  return +p.price.toFixed(2);
}

function getMarketSentiment() {
  // 模擬市場情緒 -1 到 1
  return (Math.random() - 0.5) * 2;
}

// ============ 交易引擎 ============
function calculateNAV(state) {
  const stockVal = state.holdings.reduce((s, h) => s + h.shares * h.currentPrice, 0);
  return state.cash + stockVal;
}

function calculateCommission(amount) {
  return Math.max(20, Math.round(amount * 0.001425));
}

function executeBuy(state, stock, shares, price, reason) {
  const amount = price * shares;
  const commission = calculateCommission(amount);
  const totalCost = amount + commission;

  if (totalCost > state.cash) {
    // 嘗試減少股數
    const maxShares = Math.floor((state.cash - commission) / price);
    if (maxShares < 100) return null;
    return executeBuy(state, stock, Math.floor(maxShares / 100) * 100, price, reason);
  }

  // 檢查單一持股上限
  const nav = calculateNAV(state);
  const positionRatio = amount / nav;
  if (positionRatio > 0.20) {
    const adjustedShares = Math.floor(nav * 0.20 / price / 100) * 100;
    if (adjustedShares < 100) return null;
    return executeBuy(state, stock, adjustedShares, price, reason);
  }

  state.cash -= totalCost;
  const existing = state.holdings.find(h => h.code === stock.code);
  if (existing) {
    const totalShares = existing.shares + shares;
    existing.buyPrice = (existing.shares * existing.buyPrice + amount) / totalShares;
    existing.shares = totalShares;
    existing.currentPrice = price;
  } else {
    state.holdings.push({
      code: stock.code,
      name: stock.name,
      shares,
      buyPrice: price,
      currentPrice: price,
      buyDate: todayStr(),
    });
  }

  const trade = {
    type: 'buy',
    code: stock.code,
    name: stock.name,
    shares,
    price,
    commission,
    date: todayStr(),
    time: nowTimeStr(),
    reason,
  };
  state.trades.unshift(trade);
  state.totalTrades++;
  logTrade(trade);
  return trade;
}

function executeSell(state, holding, shares, price, reason) {
  if (!holding || holding.shares < shares) return null;

  const amount = price * shares;
  const commission = calculateCommission(amount);
  const netAmount = amount - commission;

  state.cash += netAmount;
  holding.shares -= shares;
  holding.currentPrice = price;

  if (holding.shares === 0) {
    state.holdings = state.holdings.filter(h => h.code !== holding.code);
  }

  const trade = {
    type: 'sell',
    code: holding.code,
    name: holding.name,
    shares,
    price,
    commission,
    date: todayStr(),
    time: nowTimeStr(),
    reason,
  };
  state.trades.unshift(trade);
  state.totalTrades++;
  logTrade(trade);
  return trade;
}

// ============ 策略引擎 ============
function runStrategy(state) {
  const sentiment = getMarketSentiment();
  const nav = calculateNAV(state);
  const trades = [];
  const logs = [];

  // 更新所有持股的當前價格
  state.holdings.forEach(h => {
    const stock = STOCK_POOL.find(s => s.code === h.code);
    if (stock) {
      h.currentPrice = getSimulatedPrice(stock);
    }
  });

  // 1. 檢查停損
  state.holdings.forEach(h => {
    const lossRatio = h.currentPrice / h.buyPrice;
    if (lossRatio <= 0.95) {
      const trade = executeSell(state, h, h.shares, h.currentPrice, '停損出場（-5%）');
      if (trade) {
        trades.push(trade);
        logs.push(`🔴 停損賣出 ${trade.name} ${trade.shares}股 @${fmtPrice(trade.price)}（虧損 ${(lossRatio * 100 - 100).toFixed(1)}%）`);
      }
    }
  });

  // 2. 檢查獲利了結
  state.holdings.forEach(h => {
    const profitRatio = h.currentPrice / h.buyPrice;
    if (profitRatio >= 1.08) {
      const sellShares = Math.floor(h.shares / 2 / 100) * 100;
      if (sellShares >= 100) {
        const trade = executeSell(state, h, sellShares, h.currentProfit, `獲利了結（+${((profitRatio - 1) * 100).toFixed(1)}%）`);
        if (trade) {
          trades.push(trade);
          logs.push(`🟢 獲利了結賣出 ${trade.name} ${trade.shares}股 @${fmtPrice(trade.price)}（獲利 +${((profitRatio - 1) * 100).toFixed(1)}%）`);
        }
      }
    }
  });

  // 3. 根據市場情緒選擇策略
  const availableStrategies = STRATEGIES.filter(s => {
    if (s.action === 'buy') {
      // 檢查該產業是否已持有過多
      const sectorHoldings = state.holdings.filter(h => {
        const stock = STOCK_POOL.find(s2 => s2.code === h.code);
        return stock && (stock.sector === s.sector || s.sector === 'any');
      });
      const sectorValue = sectorHoldings.reduce((sum, h) => sum + h.shares * h.currentPrice, 0);
      return sectorValue / nav < (s.maxPosition || 0.15);
    }
    return true;
  });

  // 根據情緒選擇
  let selectedStrategy;
  if (sentiment > 0.2) {
    // 偏多：選擇買入策略
    const buyStrategies = availableStrategies.filter(s => s.action === 'buy');
    selectedStrategy = buyStrategies[Math.floor(Math.random() * buyStrategies.length)];
  } else if (sentiment < -0.3) {
    // 偏空：選擇賣出策略
    const sellStrategies = availableStrategies.filter(s => s.action === 'sell');
    selectedStrategy = sellStrategies[Math.floor(Math.random() * sellStrategies.length)];
  } else {
    // 中性：隨機選擇
    selectedStrategy = availableStrategies[Math.floor(Math.random() * availableStrategies.length)];
  }

  if (!selectedStrategy) {
    selectedStrategy = STRATEGIES[0];
  }

  // 4. 執行策略
  if (selectedStrategy.action === 'buy') {
    const targetStocks = STOCK_POOL.filter(s =>
      s.sector === selectedStrategy.sector || selectedStrategy.sector === 'any'
    );

    if (targetStocks.length > 0) {
      // 選擇1-2檔股票
      const numStocks = Math.min(targetStocks.length, Math.random() > 0.5 ? 2 : 1);
      const shuffled = [...targetStocks].sort(() => Math.random() - 0.5);

      for (let i = 0; i < numStocks; i++) {
        const stock = shuffled[i];
        const price = getSimulatedPrice(stock);

        // 計算可買股數（約5-10% NAV）
        const allocRatio = 0.05 + Math.random() * 0.05;
        const allocAmount = nav * allocRatio;
        const shares = Math.floor(allocAmount / price / 100) * 100;

        if (shares >= 100) {
          const trade = executeBuy(state, stock, shares, price, selectedStrategy.title);
          if (trade) {
            trades.push(trade);
            logs.push(`🔵 買入 ${trade.name}(${trade.code}) ${trade.shares}股 @${fmtPrice(trade.price)}，金額 ${fmt(trade.price * trade.shares)}`);
          }
        }
      }
    }
  } else if (selectedStrategy.action === 'sell' && state.holdings.length > 0) {
    // 賣出最弱的一檔
    const sorted = [...state.holdings].sort((a, b) => {
      const retA = a.currentPrice / a.buyPrice;
      const retB = b.currentPrice / b.buyPrice;
      return retA - retB;
    });

    const target = sorted[0];
    const sellShares = Math.min(target.shares, Math.floor(target.shares / 2 / 100) * 100);
    if (sellShares >= 100) {
      const trade = executeSell(state, target, sellShares, target.currentPrice, selectedStrategy.title);
      if (trade) {
        trades.push(trade);
        const pl = (trade.price - target.buyPrice) * trade.shares;
        logs.push(`🟡 策略賣出 ${trade.name} ${trade.shares}股 @${fmtPrice(trade.price)}，${pl >= 0 ? '獲利' : '虧損'} ${fmt(Math.abs(pl))}`);
      }
    }
  }

  // 5. 更新 NAV 歷史
  const currentNav = calculateNAV(state);
  const lastNav = state.navHistory[state.navHistory.length - 1];
  if (lastNav.date === todayStr()) {
    lastNav.value = currentNav;
  } else {
    state.navHistory.push({ date: todayStr(), value: currentNav });
  }

  // 6. 記錄策略
  const strategyLog = {
    date: todayStr(),
    time: nowTimeStr(),
    title: selectedStrategy.title,
    reason: selectedStrategy.reason,
    sentiment: sentiment.toFixed(2),
    nav: currentNav,
    trades: trades.length,
  };
  state.strategies.unshift(strategyLog);
  if (state.strategies.length > 100) state.strategies = state.strategies.slice(0, 100);

  state.lastTradeDate = todayStr();
  saveState(state);

  return { trades, logs, strategy: strategyLog, nav: currentNav, sentiment };
}

// ============ 報告生成 ============
function generateReport(state, result) {
  const nav = result.nav;
  const pl = nav - INITIAL_CASH;
  const plPct = (pl / INITIAL_CASH * 100).toFixed(2);

  let report = `
╔══════════════════════════════════════════════════╗
║        🤖 OWL 台股自動交易報告                    ║
║        ${todayStr()} ${nowTimeStr()}                      ║
╠══════════════════════════════════════════════════╣
║  📊 總資產: ${fmt(nav).padEnd(14)}                ║
║  💰 現金:   ${fmt(state.cash).padEnd(14)}          ║
║  📈 損益:   ${(pl >= 0 ? '+' : '') + fmt(pl).padEnd(12)} (${pl >= 0 ? '+' : ''}${plPct}%)  ║
║  🔄 交易次數: ${String(state.totalTrades).padEnd(10)}               ║
║  📉 市場情緒: ${result.sentiment >= 0 ? '偏多' : '偏空'} (${result.sentiment.toFixed(2)})        ║
╠══════════════════════════════════════════════════╣
║  🧠 今日策略: ${result.strategy.title.padEnd(20)} ║
╠══════════════════════════════════════════════════╣`;

  if (result.logs.length > 0) {
    report += `\n║  交易明細:`;
    result.logs.forEach(log => {
      report += `\n║  ${log}`;
    });
  } else {
    report += `\n║  今日無交易`;
  }

  if (state.holdings.length > 0) {
    report += `\n╠══════════════════════════════════════════════════╣`;
    report += `\n║  💼 目前持股:`;
    state.holdings.forEach(h => {
      const val = h.shares * h.currentPrice;
      const cost = h.shares * h.buyPrice;
      const hpl = val - cost;
      const hplPct = (hpl / cost * 100).toFixed(1);
      report += `\n║  ${h.name}(${h.code}) ${h.shares}股 @${fmtPrice(h.buyPrice)}→${fmtPrice(h.currentPrice)} ${hpl >= 0 ? '+' : ''}${hplPct}%`;
    });
  }

  report += `\n╚══════════════════════════════════════════════════╝\n`;
  return report;
}

// ============ 主程式 ============
function main() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMin = now.getUTCMinutes();
  const utcDay = now.getUTCDay();

  // 檢查是否為交易日（週一到週五 = 1-5）
  if (utcDay === 0 || utcDay === 6) {
    console.log('⛔ 週末休市，跳過交易');
    process.exit(0);
  }

  // 檢查是否在交易時段（UTC 01:00 - 05:30 = 台北 09:00 - 13:30）
  const timeVal = utcHour * 60 + utcMin;
  if (timeVal < 60 || timeVal > 330) {
    console.log(`⛔ 非交易時段 (UTC ${String(utcHour).padStart(2, '0')}:${String(utcMin).padStart(2, '0')})，跳過交易`);
    process.exit(0);
  }

  console.log(`\n🤖 OWL 台股自動交易引擎啟動`);
  console.log(`📅 ${todayStr()} ${nowTimeStr()}\n`);

  const state = loadState();
  const result = runStrategy(state);
  const report = generateReport(state, result);

  console.log(report);

  // 輸出 JSON 供其他程式使用
  const output = {
    date: todayStr(),
    time: nowTimeStr(),
    nav: result.nav,
    pl: result.nav - INITIAL_CASH,
    plPct: ((result.nav - INITIAL_CASH) / INITIAL_CASH * 100).toFixed(2),
    cash: state.cash,
    holdings: state.holdings,
    trades: result.trades,
    strategy: result.strategy,
    sentiment: result.sentiment,
    totalTrades: state.totalTrades,
  };

  console.log('📄 JSON_OUTPUT:' + JSON.stringify(output));
}

main();
