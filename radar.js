const axios = require('axios');
// const http = require('http'); // 移除：GitHub Actions 不需要 HTTP 服务器

// ==========================================
// ✨ [保留] 0. 大师思维模型库 (Strategy Engine)
// ==========================================
const MASTERS = {
    // [塔勒布] 尾部风险
    TALEB: (m, prices) => {
        const isTail = prices.some(p => Number(p) < 0.05 || Number(p) > 0.95);
        return (isTail && Number(m.liquidity) > 5000) ? 'TAIL_RISK' : null;
    },
    // [索罗斯] 反身性
    SOROS: (m) => {
        const change = Math.abs(Number(m.oneDayPriceChange || 0));
        const vol24 = Number(m.volume24hr || 0);
        return (vol24 > 10000 && change > 0.05) ? 'REFLEXIVITY_TREND' : null;
    },
    // [芒格] 确定性
    MUNGER: (m) => {
        const spread = Number(m.spread || 1);
        const vol = Number(m.volume || 0);
        return (vol > 50000 && spread < 0.01) ? 'HIGH_CERTAINTY' : null;
    },
    // [纳瓦尔] 杠杆效应
    NAVAL: (m, category) => {
        const vol = Number(m.volume || 0);
        return (category === 'TECH' && vol > 20000) ? 'TECH_LEVERAGE' : null;
    }
};

// ==========================================
// 1. 优先级排序 (保留)
// ==========================================
const CATEGORY_PRIORITY = [
    "politics", "economy", "finance", "crypto", 
    "tech", "geopolitics", "climate-science", "world"
];

// ==========================================
// 2. 7大板块过滤配置 (保留)
// ==========================================
const FILTER_CONFIG = {
    "politics": {
        signals: ["election", "nominate", "strike", "shutdown", "fed", "president", "war", "cabinet", "senate", "house"],
        noise: ["tweet", "post", "mention", "says", "follower", "wear", "odds", "poll", "approval"],
    },
    "economy": {
        signals: ["fed", "powell", "rate", "inflation", "cpi", "gdp", "recession", "ecb", "treasury", "job", "unemployment"],
        noise: ["brazil", "turkey", "ranking", "statement"],
    },
    "finance": {
        signals: ["gold", "silver", "s&p", "nasdaq", "oil", "commodity", "largest company", "revenue", "stock"],
        noise: ["acquisition", "merger", "ipo", "earnings call", "dividend"],
    },
    "crypto": {
        signals: ["bitcoin", "ethereum", "solana", "etf", "flow", "price", "hit", "market cap"],
        noise: ["fdv", "launch", "airdrop", "listing", "mint", "floor price", "nft", "meme", "token"],
    },
    "tech": {
        signals: ["ai model", "benchmark", "gemini", "gpt", "nvidia", "apple", "microsoft", "semiconductor", "agi"],
        noise: ["app store", "download", "tiktok", "charizard", "pokemon", "influencer", "game"],
    },
    "geopolitics": {
        signals: ["strike", "ceasefire", "supreme leader", "regime", "invasion", "nuclear", "war", "military", "border"],
        noise: ["costa rica", "thailand", "parliamentary election", "local"],
    },
    "climate-science": {
        signals: ["earthquake", "spacex", "measles", "virus", "pandemic", "temperature", "volcano", "hurricane"],
        noise: ["snow", "inches", "rain", "weather in", "nyc", "washington", "cloud"],
    },
    "world": {
        signals: ["coalition", "prime minister", "eu", "nato", "un", "trade deal"],
        noise: ["us election", "us strike"]
    }
};

// ==========================================
// 3. 辅助模块：一号机去重 (🔥已修改：指向 Central-Bank🔥)
// ==========================================
async function generateSniperTargets() {
    // 🎯 核心修改：这里不再读取当前仓库 Issues，而是去读取 Central-Bank
    const token = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const COMMAND_REPO = "wenfp108/Central-Bank"; // 指挥部

    // 如果没有 Token，无法获取私有指令，返回空数组（不做去重）
    if (!token) {
        console.log("⚠️ No Token found for Central-Bank sync. De-duplication disabled.");
        return [];
    }

    const issuesUrl = `https://api.github.com/repos/${COMMAND_REPO}/issues?state=open&per_page=100`;

    try {
        console.log("📡 [Radar] Syncing with Central-Bank for de-duplication...");
        const resp = await axios.get(issuesUrl, {
            headers: { 
                Authorization: `Bearer ${token}`, 
                Accept: 'application/vnd.github.v3+json' 
            }
        });
        
        const now = new Date();
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const currMonth = months[now.getMonth()], nextMonth = months[(now.getMonth() + 1) % 12];
        const currYear = String(now.getFullYear()), currDateStr = `${currMonth} ${now.getDate()}`;

        let specificTargets = [];
        
        // 🎯 逻辑保持一致：只提取 [poly] 指令
        const polyIssues = resp.data.filter(issue => issue.title.toLowerCase().includes('[poly]'));

        polyIssues.forEach(issue => {
            let t = issue.title.replace(/\[poly\]/gi, '').trim(); // 去除标签
            
            if (t.includes("{month}") || t.includes("{year}") || t.includes("{date}")) {
                let q1 = t.replace(/{month}/g, currMonth).replace(/{year}/g, currYear).replace(/{date}/g, currDateStr);
                specificTargets.push(normalizeText(q1));
                if (t.includes("{month}")) {
                    let q2 = t.replace(/{month}/g, nextMonth).replace(/{year}/g, currYear).replace(/{date}/g, currDateStr);
                    specificTargets.push(normalizeText(q2));
                }
            } else {
                specificTargets.push(normalizeText(t));
            }
        });
        console.log(`✅ Loaded ${specificTargets.length} active Sniper targets to exclude.`);
        return specificTargets;
    } catch (e) { 
        console.error("❌ Failed to fetch Central-Bank issues:", e.message);
        return []; 
    }
}

function normalizeText(str) {
    return str.toLowerCase().replace(/[?!]/g, "").replace(/\s+/g, " ").trim();
}

// ==========================================
// 4. 雷达主任务 (GitHub Native 版)
// ==========================================
async function runRadarTask() {
    const REPO_OWNER = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
    let REPO_NAME = process.env.REPO_NAME;
    if (!REPO_NAME && process.env.GITHUB_REPOSITORY) {
         REPO_NAME = process.env.GITHUB_REPOSITORY.split('/')[1];
    }
    const TOKEN = process.env.MY_PAT || process.env.GITHUB_TOKEN;

    if (!TOKEN) return console.log("❌ Missing Secrets! (MY_PAT required)");

    // 1. 获取黑名单 (去重核心)
    const sniperBlacklist = await generateSniperTargets();

    console.log("📡 [Radar] Scanning Top 100 Global Markets...");
    const url = `https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false&order=volume24hr&ascending=false`;

    try {
        const resp = await axios.get(url);
        const events = resp.data;
        let trendingData = [];

        events.forEach(event => {
            if (!event.markets) return;

            // --- A. 板块锁定 ---
            const eventTags = event.tags ? event.tags.map(t => t.slug) : [];
            let primaryTag = null;
            for (const cat of CATEGORY_PRIORITY) {
                if (eventTags.includes(cat)) { primaryTag = cat; break; }
            }
            if (!primaryTag) return;

            // --- B. 去重 (Subtractive Logic) ---
            const eventTitleClean = normalizeText(event.title);
            // 如果标题包含在黑名单里，或者黑名单包含标题，则视为撞车，跳过
            if (sniperBlacklist.some(target => eventTitleClean.includes(target) || target.includes(eventTitleClean))) {
                // console.log(`[SKIP] Duplicate target found: ${event.title}`); // 可选日志
                return;
            }

            // --- C. 过滤 ---
            const rules = FILTER_CONFIG[primaryTag];
            if (rules.noise.some(kw => eventTitleClean.includes(kw))) return;
            const isLoose = ["politics", "geopolitics", "world"].includes(primaryTag);
            if (!isLoose && !rules.signals.some(kw => eventTitleClean.includes(kw))) return;

            // --- D. 统一数据提取 ---
            event.markets.forEach(m => {
                if (!m.active || m.closed) return;
                
                const vol24h = Number(m.volume24hr || 0);
                if (vol24h < 10000) return;

                let prices = [], outcomes = [];
                try {
                    prices = JSON.parse(m.outcomePrices);
                    outcomes = JSON.parse(m.outcomes);
                } catch (e) { return; }

                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");

                // --- ✨ 大师策略打标 ---
                const masterTags = [];
                const categoryUpper = primaryTag.toUpperCase();
                
                for (const [name, logic] of Object.entries(MASTERS)) {
                    const tag = logic(m, prices, categoryUpper);
                    if (tag) masterTags.push(tag);
                }
                if (masterTags.length === 0) masterTags.push("RAW_MARKET");
                // ---------------------

                trendingData.push({
                    slug: event.slug,
                    ticker: m.slug,
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    prices: priceStr,
                    volume: Math.round(Number(m.volume || 0)),
                    liquidity: Math.round(Number(m.liquidity || 0)),
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A", 
                    dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(vol24h),
                    spread: m.spread ? (Number(m.spread) * 100).toFixed(2) + "%" : "N/A", 
                    sortOrder: Number(m.groupItemThreshold || 0), 
                    updatedAt: m.updatedAt,
                    category: categoryUpper,
                    url: `https://polymarket.com/event/${event.slug}`,
                    strategy_tags: masterTags 
                });
            });
        });

        trendingData.sort((a, b) => b.vol24h - a.vol24h);
        const top30 = trendingData.slice(0, 30);

        if (top30.length > 0) {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
            
            const fileName = `radar-${year}-${month}-${day}-${timePart}.json`;
            const datePart = now.toISOString().split('T')[0];
            const path = `data/trends/${datePart}/${fileName}`;

            await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
                message: `Radar Update: ${fileName}`,
                content: Buffer.from(JSON.stringify(top30, null, 2)).toString('base64')
            }, { headers: { Authorization: `Bearer ${TOKEN}` } });
            
            console.log(`✅ Radar Success: Filtered & Uploaded ${top30.length} signals to ${path}`);
        } else {
            console.log("⚠️ No high-value signals found.");
        }

    } catch (e) { console.error("❌ Radar Error:", e.message); }
}

// ==========================================
// 5. 执行入口 (脚本化)
// ==========================================
(async () => {
    console.log("🚀 Radar Agent Initializing...");
    try {
        await runRadarTask();
        console.log("🏁 Radar Scan Complete. Exiting.");
        process.exit(0);
    } catch (error) {
        console.error("❌ Fatal Radar Error:", error);
        process.exit(1);
    }
})();
