const axios = require('axios');

// ==========================================
// 0. 策略引擎
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
// 1. 板块本地筛选配置 (Local Filter)
// ==========================================
// 这里的 key 对应本地匹配逻辑，不再用于 API 请求
const SECTOR_CONFIG = {
    "POLITICS":        { sort: "vol24h",    minVol: 10000, signals: ["election", "nominate", "strike", "shutdown", "fed", "president", "war", "cabinet"], noise: ["poll", "approval"] },
    "ECONOMY":         { sort: "vol24h",    minVol: 10000, signals: ["fed", "rate", "inflation", "gdp"], noise: ["ranking"] },
    "CRYPTO":          { sort: "vol24h",    minVol: 10000, signals: ["bitcoin", "ethereum", "solana", "etf"], noise: ["nft", "meme"] },
    "TECH":            { sort: "vol24h",    minVol: 5000,  signals: ["ai", "gpt", "nvidia", "apple", "semiconductor"], noise: ["game"] },
    "GEOPOLITICS":     { sort: "vol24h",    minVol: 5000,  signals: ["strike", "ceasefire", "invasion", "nuclear", "war", "border"], noise: ["local"] },
    "WORLD":           { sort: "vol24h",    minVol: 5000,  signals: ["prime minister", "eu", "nato", "trade"], noise: [] },
    
    // 💎 深度派：门槛极低，确保能在 Top 1000 里被捞出来
    "FINANCE":         { sort: "liquidity", minVol: 1000, signals: ["gold", "oil", "s&p", "nasdaq", "stock", "revenue"], noise: ["dividend"] },
    "CLIMATE-SCIENCE": { sort: "liquidity", minVol: 500,  signals: ["temperature", "spacex", "virus", "hurricane", "earthquake"], noise: ["weather"] }
};

const CATEGORY_PRIORITY = Object.keys(SECTOR_CONFIG).map(k => k.toLowerCase());

// ==========================================
// 2. 黑名单同步
// ==========================================
async function generateSniperTargets() {
    const token = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    const COMMAND_REPO = "wenfp108/Central-Bank";
    if (!token) { console.log("⚠️ No Token for Central-Bank sync."); return []; }
    const issuesUrl = `https://api.github.com/repos/${COMMAND_REPO}/issues?state=open&per_page=100`;

    try {
        console.log("📡 [Radar] Syncing with Central-Bank for de-duplication...");
        const resp = await axios.get(issuesUrl, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } });
        const now = new Date();
        const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        
        const targetDates = [];
        for (let i = 0; i < 3; i++) {
            const d = new Date(now);
            d.setDate(now.getDate() + i);
            targetDates.push({ str: `${months[d.getMonth()]} ${d.getDate()}`, year: d.getFullYear() });
        }
        
        let specificTargets = [];
        const polyIssues = resp.data.filter(issue => issue.title.toLowerCase().includes('[poly]'));

        polyIssues.forEach(issue => {
            let t = issue.title.replace(/\[poly\]/gi, '').trim();
            if (t.includes("{date}")) {
                targetDates.forEach(dateObj => {
                    let q = t.replace(/{date}/g, dateObj.str).replace(/{year}/g, String(dateObj.year));
                    specificTargets.push(normalizeText(q));
                });
            } else {
                specificTargets.push(normalizeText(t));
            }
        });
        return specificTargets;
    } catch (e) { console.error("❌ Failed to fetch Central-Bank issues:", e.message); return []; }
}

function normalizeText(str) { return str.toLowerCase().replace(/[?!]/g, "").replace(/\s+/g, " ").trim(); }

// ==========================================
// 3. 雷达主任务 (Deep Trawl)
// ==========================================
async function runRadarTask() {
    const REPO_OWNER = process.env.REPO_OWNER || process.env.GITHUB_REPOSITORY_OWNER;
    let REPO_NAME = process.env.REPO_NAME;
    if (!REPO_NAME && process.env.GITHUB_REPOSITORY) REPO_NAME = process.env.GITHUB_REPOSITORY.split('/')[1];
    const TOKEN = process.env.MY_PAT || process.env.GITHUB_TOKEN;
    if (!TOKEN) return console.log("❌ Missing Secrets! (MY_PAT required)");

    const sniperBlacklist = await generateSniperTargets();

    // 🔥 关键修改：一次性抓取全网 Top 1000，不分类，不报错
    console.log("📡 [Radar] Deep Trawling Top 1000 Global Markets...");
    const url = `https://gamma-api.polymarket.com/events?limit=1000&active=true&closed=false&order=volume24hr&ascending=false`;

    try {
        const resp = await axios.get(url);
        const events = resp.data;
        let allCandidates = [];

        events.forEach(event => {
            if (!event.markets) return;

            // 1. 本地分类 (Local Classification)
            const eventTags = event.tags ? event.tags.map(t => t.slug) : [];
            const matchingCategories = CATEGORY_PRIORITY.filter(cat => eventTags.includes(cat));
            if (matchingCategories.length === 0) return;

            const primaryTag = matchingCategories[0].toUpperCase();
            const config = SECTOR_CONFIG[primaryTag];
            if (!config) return; 

            const displayCategory = matchingCategories.map(c => c.toUpperCase()).join(" | ");
            const eventTitleClean = normalizeText(event.title);
            
            // 2. 过滤
            if (sniperBlacklist.some(target => eventTitleClean.includes(target) || target.includes(eventTitleClean))) return;
            if (config.noise.some(kw => eventTitleClean.includes(kw))) return;
            const isLoose = ["POLITICS", "GEOPOLITICS", "WORLD"].includes(primaryTag);
            if (!isLoose && !config.signals.some(kw => eventTitleClean.includes(kw))) return;

            event.markets.forEach(m => {
                if (!m.active || m.closed) return;
                const vol24h = Number(m.volume24hr || 0);
                
                // 3. 动态门槛
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
                    ticker: m.slug,
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

        console.log(`📊 Filtered ${allCandidates.length} high-quality candidates from Top 1000.`);

        // ==========================================
        // 🔥 核心逻辑：30+N 混合编队
        // ==========================================

        // 1. 全网大排名 (按资金量)
        allCandidates.sort((a, b) => b.vol24h - a.vol24h);

        // 2. 选出 Top 30 全网基准 (Top 30 Volume Leaders)
        const finalList = [];
        const seenSlugs = new Set();

        for (const item of allCandidates) {
            if (finalList.length >= 30) break;
            if (!seenSlugs.has(item.slug)) {
                finalList.push(item);
                seenSlugs.add(item.slug);
            }
        }
        console.log(`📊 Baseline: Locked Top 30 global signals.`);

        // 3. 增补各板块遗珠 (Sector Gems)
        Object.keys(SECTOR_CONFIG).forEach(sector => {
            const config = SECTOR_CONFIG[sector];
            
            // 从内存池里找该板块的所有兵
            let sectorCandidates = allCandidates.filter(i => i.category.includes(sector));
            
            // 按该板块规则排序 (Finance/Science 按流动性排)
            if (config.sort === "liquidity") {
                sectorCandidates.sort((a, b) => b.liquidity - a.liquidity);
            } else {
                sectorCandidates.sort((a, b) => b.vol24h - a.vol24h);
            }

            // 取前 3
            let count = 0;
            for (const item of sectorCandidates) {
                if (count >= 3) break;
                if (!seenSlugs.has(item.slug)) {
                    console.log(`   + Adding [${sector}] gem: ${item.slug.substring(0, 20)}...`);
                    finalList.push(item);
                    seenSlugs.add(item.slug);
                }
                count++;
            }
        });

        // 4. 最终排序
        finalList.sort((a, b) => b.vol24h - a.vol24h);

        // 上传逻辑
        if (finalList.length > 0) {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            const timePart = `${now.getHours().toString().padStart(2, '0')}_${now.getMinutes().toString().padStart(2, '0')}`;
            const fileName = `radar-${year}-${month}-${day}-${timePart}.json`;
            const datePart = now.toISOString().split('T')[0];
            const path = `data/trends/${datePart}/${fileName}`;
            
            await axios.put(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`, {
                message: `Radar Update: ${fileName} (Count: ${finalList.length})`,
                content: Buffer.from(JSON.stringify(finalList, null, 2)).toString('base64')
            }, { headers: { Authorization: `Bearer ${TOKEN}` } });
            console.log(`✅ Radar Success: Uploaded ${finalList.length} signals.`);
        } else { console.log("⚠️ No high-value signals found."); }

    } catch (e) { console.error("❌ Radar Error:", e.message); }
}

(async () => {
    try { await runRadarTask(); process.exit(0); } catch (e) { console.error(e); process.exit(1); }
})();
