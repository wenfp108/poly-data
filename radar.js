const axios = require('axios');

// ==========================================
// 0. 策略引擎 (原封不动)
// ==========================================
const MASTERS = {
    TALEB: (m, prices) => {
        const isTail = prices.some(p => Number(p) < 0.05 || Number(p) > 0.95);
        return (isTail && Number(m.liquidity) > 5000) ? 'TAIL_RISK' : null;
    },
    SOROS: (m) => {
        const change = Math.abs(Number(m.oneDayPriceChange || 0));
        const vol24 = Number(m.volume24hr || 0);
        return (vol24 > 10000 && change > 0.05) ? 'REFLEXIVITY_TREND' : null;
    },
    MUNGER: (m) => {
        const spread = Number(m.spread || 1);
        const vol = Number(m.volume || 0);
        return (vol > 50000 && spread < 0.01) ? 'HIGH_CERTAINTY' : null;
    },
    NAVAL: (m, category) => {
        const vol = Number(m.volume || 0);
        return (category.includes('TECH') && vol > 20000) ? 'TECH_LEVERAGE' : null;
    }
};

// ==========================================
// 1. 板块配置 (保持阶梯门槛)
// ==========================================
const SECTOR_CONFIG = {
    "POLITICS":        { sort: "vol24h",    minVol: 10000, signals: ["election", "nominate", "strike", "shutdown", "fed", "president", "war"], noise: ["tweet", "poll", "approval"] },
    "ECONOMY":         { sort: "vol24h",    minVol: 10000, signals: ["fed", "rate", "inflation", "gdp"], noise: ["ranking"] },
    "CRYPTO":          { sort: "vol24h",    minVol: 10000, signals: ["bitcoin", "ethereum", "solana", "etf"], noise: ["nft", "meme"] },
    "TECH":            { sort: "vol24h",    minVol: 5000,  signals: ["ai", "gpt", "nvidia", "apple", "semiconductor"], noise: ["game"] },
    "GEOPOLITICS":     { sort: "vol24h",    minVol: 5000,  signals: ["strike", "ceasefire", "invasion", "nuclear", "war", "border"], noise: ["local"] },
    "WORLD":           { sort: "vol24h",    minVol: 5000,  signals: ["prime minister", "eu", "nato", "trade"], noise: [] },
    "FINANCE":         { sort: "liquidity", minVol: 1000, signals: ["gold", "oil", "s&p", "nasdaq", "stock"], noise: ["dividend"] },
    "CLIMATE-SCIENCE": { sort: "liquidity", minVol: 500,  signals: ["temperature", "spacex", "virus", "hurricane"], noise: ["weather"] }
};

const CATEGORY_PRIORITY = Object.keys(SECTOR_CONFIG).map(k => k.toLowerCase());

// ==========================================
// 2. 物理去重：读取 Sniper 已占领的 Slug
// ==========================================
async function getSniperActiveSlugs(TOKEN, REPO_OWNER, REPO_NAME) {
    const now = new Date().toISOString().split('T')[0];
    const path = `data/strategy/${now}`;
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
    try {
        const resp = await axios.get(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
        const latestFile = resp.data.filter(f => f.name.startsWith('sniper-')).sort().pop();
        if (!latestFile) return new Set();
        const fileData = await axios.get(latestFile.download_url);
        return new Set(fileData.data.map(item => item.slug));
    } catch (e) { return new Set(); }
}

async function generateSniperTargets() {
    const token = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const COMMAND_REPO = "wenfp108/Central-Bank";
    if (!token) return [];
    const issuesUrl = `https://api.github.com/repos/${COMMAND_REPO}/issues?state=open&per_page=100`;
    try {
        const resp = await axios.get(issuesUrl, { headers: { Authorization: `Bearer ${token}` } });
        return resp.data.filter(i => i.title.toLowerCase().includes('[poly]')).map(i => normalizeText(i.title.replace(/\[poly\]/gi, '')));
    } catch (e) { return []; }
}

function normalizeText(str) { return str.toLowerCase().replace(/[?!]/g, "").replace(/\s+/g, " ").trim(); }

// ==========================================
// 3. 雷达主任务
// ==========================================
async function runRadarTask() {
    const TOKEN = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const REPO_OWNER = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
    let REPO_NAME = process.env.REPO_NAME || (process.env.GITHUB_REPOSITORY ? process.env.GITHUB_REPOSITORY.split('/')[1] : null);
    
    // 1. 同步狙击手状态
    const sniperSlugs = await getSniperActiveSlugs(TOKEN, REPO_OWNER, REPO_NAME);
    const sniperBlacklist = await generateSniperTargets();

    console.log("📡 [Radar] Deep Trawling Top 1000 Global Markets...");
    const url = `https://gamma-api.polymarket.com/events?limit=1000&active=true&closed=false&order=volume24hr&ascending=false`;

    try {
        const resp = await axios.get(url);
        let allCandidates = [];

        resp.data.forEach(event => {
            if (!event.markets) return;

            // 🔥 物理减法：如果狙击手在盯着这个话题，雷达直接整体撤退
            if (sniperSlugs.has(event.slug)) return;

            const eventTags = event.tags ? event.tags.map(t => t.slug) : [];
            const matchingCategories = CATEGORY_PRIORITY.filter(cat => eventTags.includes(cat));
            if (matchingCategories.length === 0) return;

            const primaryTag = matchingCategories[0].toUpperCase();
            const config = SECTOR_CONFIG[primaryTag];
            const displayCategory = matchingCategories.map(c => c.toUpperCase()).join(" | ");
            const eventTitleClean = normalizeText(event.title);
            
            // 黑名单过滤
            if (sniperBlacklist.some(target => eventTitleClean.includes(target) || target.includes(eventTitleClean))) return;
            if (config.noise.some(kw => eventTitleClean.includes(kw))) return;

            event.markets.forEach(m => {
                if (!m.active || m.closed) return;
                const vol24h = Number(m.volume24hr || 0);
                if (vol24h < config.minVol) return;

                let prices = [], outcomes = [];
                try { prices = JSON.parse(m.outcomePrices); outcomes = JSON.parse(m.outcomes); } catch (e) { return; }
                let priceStr = outcomes.map((o, i) => `${o}: ${(Number(prices[i]) * 100).toFixed(1)}%`).join(" | ");

                const masterTags = [];
                for (const [name, logic] of Object.entries(MASTERS)) {
                    const tag = logic(m, prices, displayCategory);
                    if (tag) masterTags.push(tag);
                }
                if (masterTags.length === 0) masterTags.push("RAW_MARKET");

                allCandidates.push({
                    slug: event.slug,
                    ticker: m.slug, // 这里保留合约唯一标识，支持 Jan 和 Feb 同时存在
                    question: m.groupItemTitle || m.question,
                    eventTitle: event.title,
                    prices: priceStr,
                    volume: Math.round(Number(m.volume || 0)),
                    liquidity: Math.round(Number(m.liquidity || 0)),
                    endDate: m.endDate ? m.endDate.split("T")[0] : "N/A", 
                    dayChange: m.oneDayPriceChange ? (Number(m.oneDayPriceChange) * 100).toFixed(2) + "%" : "0.00%",
                    vol24h: Math.round(vol24h),
                    updatedAt: m.updatedAt,
                    category: displayCategory,
                    strategy_tags: masterTags
                });
            });
        });

        // 2. 选出 Top 30 基准（基于 Ticker，允许同事件不同日期共存）
        allCandidates.sort((a, b) => b.vol24h - a.vol24h);
        const finalList = [];
        const seenTickers = new Set();

        for (const item of allCandidates) {
            if (finalList.length >= 30) break;
            finalList.push(item);
            seenTickers.add(item.ticker);
        }

        // 3. 各板块增补 (Sector Gems)
        Object.keys(SECTOR_CONFIG).forEach(sector => {
            const config = SECTOR_CONFIG[sector];
            let sectorCandidates = allCandidates.filter(i => i.category.includes(sector));
            if (config.sort === "liquidity") sectorCandidates.sort((a, b) => b.liquidity - a.liquidity);
            else sectorCandidates.sort((a, b) => b.vol24h - a.vol24h);

            let count = 0;
            for (const item of sectorCandidates) {
                if (count >= 3) break;
                if (!seenTickers.has(item.ticker)) {
                    finalList.push(item);
                    seenTickers.add(item.ticker);
                }
                count++;
            }
        });

        finalList.sort((a, b) => b.vol24h - a.vol24h);

        // 4. 上传
        if (finalList.length > 0) {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
            const path = `data/trends/${now.toISOString().split('T')[0]}/radar-${year}-${month}-${day}-${timePart}.json`;
            
            await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
                message: `Radar Update (Full Subtraction Mode)`,
                content: Buffer.from(JSON.stringify(finalList, null, 2)).toString('base64')
            }, { headers: { Authorization: `Bearer ${TOKEN}` } });
            console.log(`✅ Radar Success: Subtracted ${sniperSlugs.size} Sniper topics. Uploaded ${finalList.length} items.`);
        }

    } catch (e) { console.error("❌ Radar Error:", e.message); }
}

(async () => {
    try { await runRadarTask(); process.exit(0); } catch (e) { process.exit(1); }
})();
