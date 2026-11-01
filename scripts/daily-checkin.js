import axios from "axios";
import CryptoJS from "crypto-js";

const JM_VERSION = "2.0.20";
const JM_SECRET = "185Hcomic3PAPP7R";
const SETTING_AES_SEEDS = [JM_SECRET, "18comicAPPContent"];
const HOSTCFG_AES_SEED = "diosfjckwpqpdfjkvnqQjsik";
const MAKEUP_LIMIT_DEFAULT = 5;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

const HOST_CONFIG_URLS = [
  "https://rup4a04-c02.tos-cn-hongkong.bytepluses.com/newsvr-2025.txt",
  "https://rup4a04-c01.tos-ap-southeast-1.bytepluses.com/newsvr-2025.txt",
];
const FALLBACK_API_BASES = ["https://www.cdnhjk.net"];

function nowTs() {
  return String(Date.now());
}

function beijingToday() {
  const shifted = new Date(Date.now() + BEIJING_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function formatDateParts(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function md5Hex(text) {
  return CryptoJS.MD5(text).toString(CryptoJS.enc.Hex);
}

function randomDeviceId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 9; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function generateUserAgent() {
  const deviceId = randomDeviceId();
  const androidVersions = ["10", "11", "12", "13", "14", "15"];
  const chromeVersions = [
    "114.0.5735.196",
    "116.0.5845.172",
    "118.0.5993.111",
    "119.0.6045.194",
    "120.0.6099.230",
    "121.0.6167.178",
    "122.0.6261.119",
    "123.0.6312.118",
    "124.0.6367.179",
    "125.0.6422.165",
  ];
  const buildCodes = [
    "TQ1A.230305.002",
    "UP1A.231005.007",
    "UQ1A.240205.002",
    "AP1A.240405.002",
  ];

  const android =
    androidVersions[Math.floor(Math.random() * androidVersions.length)] || "13";
  const chrome =
    chromeVersions[Math.floor(Math.random() * chromeVersions.length)] ||
    "120.0.6099.230";
  const build =
    buildCodes[Math.floor(Math.random() * buildCodes.length)] ||
    "TQ1A.230305.002";

  return `Mozilla/5.0 (Linux; Android ${android}; ${deviceId} Build/${build}; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome} Mobile Safari/537.36`;
}

function normalizeBase64(raw) {
  const compact = String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (!compact) return null;

  const body = compact.replace(/=+$/g, "");
  if (!body || !/^[A-Za-z0-9+/]*$/.test(body)) return null;

  const mod = body.length % 4;
  if (mod === 1) return null;
  if (mod === 0) return body;

  return `${body}${"=".repeat(4 - mod)}`;
}

function aesEcbDecrypt(ciphertext, key) {
  const decrypted = CryptoJS.AES.decrypt(ciphertext, CryptoJS.enc.Utf8.parse(key), {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7,
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

function parseLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function decodeValue(value, ts) {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      return decodeValue(parsed, ts);
    } catch {
      return value;
    }
  }

  if (Array.isArray(value)) return value;

  if (value && typeof value === "object") {
    const obj = Object.fromEntries(
      Object.entries(value).map(([k, v]) => [String(k), v])
    );
    const dataField = obj.data;
    if (typeof dataField === "string" && dataField.trim()) {
      const rawData = dataField.trim();
      const normalizedB64 = normalizeBase64(rawData);
      if (normalizedB64) {
        for (const seed of SETTING_AES_SEEDS) {
          try {
            const key = md5Hex(`${ts}${seed}`);
            const decrypted = aesEcbDecrypt(normalizedB64, key);
            if (decrypted.trim()) {
              // 解密结果写回 data，保留外层字段
              return { ...obj, data: parseLoose(decrypted.trim()) };
            }
          } catch {
            // 尝试下一个密钥
          }
        }
      }
      return { ...obj, data: parseLoose(rawData) };
    }
    return obj;
  }

  return value;
}

async function decodeResponse(raw, ts) {
  let text = "";
  if (raw instanceof ArrayBuffer) {
    text = new TextDecoder("utf-8").decode(new Uint8Array(raw));
  } else if (raw && typeof raw === "object" && Buffer.isBuffer(raw)) {
    text = raw.toString("utf-8");
  } else if (typeof raw === "string") {
    text = raw;
  } else {
    return raw;
  }

  try {
    const parsed = JSON.parse(text);
    return decodeValue(parsed, ts);
  } catch {
    return text;
  }
}

// 会话 Cookie: AVS
let SESSION_ID = "";

function buildAuthHeaders(ts) {
  const token = md5Hex(`${ts}${JM_VERSION}`);
  return {
    token,
    tokenparam: `${ts},${JM_VERSION}`,
    "user-agent": generateUserAgent(),
  };
}

async function tryRequest(config) {
  const ts = nowTs();
  const url = config.url;
  const headers = {
    ...buildAuthHeaders(ts),
    Host: new URL(url).host,
    ...(config.headers || {}),
  };

  if (config.jwt) {
    headers.Authorization = `Bearer ${config.jwt}`;
  }

  if (SESSION_ID) {
    headers.Cookie = `AVS=${SESSION_ID}`;
  }

  const response = await axios({
    method: config.method || "GET",
    url,
    headers,
    data: config.data,
    params: config.params,
    timeout: 10000,
    responseType: "arraybuffer",
    validateStatus: () => true,
  });

  const decoded = await decodeResponse(response.data, ts);

  const status = Number(response.status || 0);
  if (status < 200 || status >= 300) {
    throw new Error(resolveServerMessage(decoded, `HTTP ${status}`));
  }

  // 业务码校验: 错误时 HTTP 仍为 200
  if (
    decoded &&
    typeof decoded === "object" &&
    !Array.isArray(decoded) &&
    "code" in decoded
  ) {
    const bizCode = Number(decoded.code);
    if (Number.isFinite(bizCode) && bizCode !== 200) {
      const msg = resolveServerMessage(decoded, `业务码 ${bizCode}`);
      throw new Error(`[code=${bizCode}] ${msg}`);
    }
  }

  return decoded;
}

function resolveServerMessage(payload, fallback) {
  const candidates = [
    payload?.errorMsg,
    payload?.msg,
    payload?.message,
    payload?.data?.errorMsg,
    payload?.data?.msg,
    payload?.data?.message,
    typeof payload?.data === "string" ? payload.data : "",
    typeof payload === "string" ? payload : "",
  ];

  for (const candidate of candidates) {
    const text = String(candidate ?? "").trim();
    if (!text) continue;
    // 跳过 HTML 错误页
    if (text.startsWith("<") || text.length > 200) continue;
    return text;
  }

  return fallback;
}

function normalizeBaseUrl(url) {
  const raw = String(url || "").trim().replace(/\/+$/g, "");
  if (!raw) return "";
  return /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
}

async function loadHostPool() {
  for (const url of HOST_CONFIG_URLS) {
    try {
      const res = await axios.get(url, { timeout: 8000, validateStatus: () => true });
      if (res.status < 200 || res.status >= 300) continue;
      const normalized = String(res.data || "").replace(/[^A-Za-z0-9+/=]/g, "");
      const plain = aesEcbDecrypt(normalized, md5Hex(HOSTCFG_AES_SEED));
      const parsed = JSON.parse(plain);
      if (Array.isArray(parsed.Server)) {
        return parsed.Server.map((item) => String(item || "").trim()).filter(Boolean);
      }
    } catch {
      // 尝试下一个地址
    }
  }
  return [];
}

async function probeSetting(baseUrl) {
  const tsSec = String(Math.floor(Date.now() / 1000));
  const res = await axios.get(`${baseUrl}/setting?app_img_shunt=1&t=${tsSec}`, {
    timeout: 8000,
    validateStatus: () => true,
    headers: {
      token: md5Hex(`${tsSec}${JM_SECRET}`),
      tokenparam: `${tsSec},${JM_VERSION}`,
      "user-agent": generateUserAgent(),
    },
  });
  if (res.status < 200 || res.status >= 300) return false;
  try {
    const decoded = await decodeResponse(res.data, tsSec);
    return Boolean(decoded && typeof decoded === "object");
  } catch {
    return false;
  }
}

async function resolveBaseUrl() {
  const pool = await loadHostPool();
  const candidates = [
    ...new Set([...pool, ...FALLBACK_API_BASES].map(normalizeBaseUrl)),
  ].filter(Boolean);
  for (const baseUrl of candidates) {
    try {
      if (await probeSetting(baseUrl)) {
        console.log(`[jm] 使用 API 域名: ${baseUrl}`);
        return baseUrl;
      }
      console.log(`[jm] 域名不可用, 跳过: ${baseUrl}`);
    } catch {
      console.log(`[jm] 域名不可用, 跳过: ${baseUrl}`);
    }
  }
  throw new Error("未找到可用的 API 域名");
}

async function login(baseUrl, account, password) {
  console.log("[jm] 正在登录...");
  const result = await tryRequest({
    method: "POST",
    url: `${baseUrl}/login`,
    data: new URLSearchParams({ username: account, password }).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
  });

  // 兼容明文与解密后的响应
  const dataObj = result?.data && typeof result.data === "object" ? result.data : result;
  const jwtToken = String(dataObj?.jwttoken || "").trim();
  const uid = String(dataObj?.uid || "").trim();
  const sessionId = String(dataObj?.s || dataObj?.session || "").trim();

  if (!jwtToken) {
    const errorMsg = result?.errorMsg || result?.msg || "未获取到 jwtToken";
    throw new Error(`登录失败: ${errorMsg}`);
  }

  SESSION_ID = sessionId || "";

  console.log(
    `[jm] 登录成功, uid=${uid}${SESSION_ID ? "" : " (未返回会话 Cookie, 将仅用 Bearer 鉴权)"}`
  );
  return { jwtToken, uid, sessionId, userInfo: result };
}

// 兼容 { code, data } 包装
function unwrapData(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const inner = payload.data;
  if (inner && typeof inner === "object") return inner;
  if (typeof inner === "string" && inner.trim()) {
    try {
      return JSON.parse(inner);
    } catch {
      return payload;
    }
  }
  return payload;
}

function readMsg(payload) {
  return resolveServerMessage(payload, "");
}

function isAlreadySigned(msg) {
  return /已經簽到過了|已经签到过了|已簽到|已签到/.test(msg);
}

// 成功文案是奖励摘要（如 "Jcoin:1 EXP:1"），按失败关键字判定
const SIGN_FAIL_RE =
  /失敗|失败|錯誤|错误|無法|无法|不能|尚未|未開始|未开始|已結束|已结束|已過期|已过期/;

function classifySignMsg(msg) {
  if (!msg) return "success";
  if (isAlreadySigned(msg)) return "already";
  if (SIGN_FAIL_RE.test(msg)) return "failed";
  return "success";
}

function findTodayCell(record, day) {
  const cells = Array.isArray(record) ? record.flat() : [];
  return cells.find((cell) => cell && Number(cell.date) === Number(day)) || null;
}

function logDailySummary(daily) {
  if (!daily || typeof daily !== "object") return;
  const parts = [
    `活动=${daily.event_name ?? "-"}`,
    `daily_id=${daily.daily_id ?? "-"}`,
    `连续进度=${daily.currentProgress ?? "-"}`,
    `3天奖励=${daily.three_days_coin ?? "-"}Jcoin/${daily.three_days_exp ?? "-"}EXP`,
    `7天奖励=${daily.seven_days_coin ?? "-"}Jcoin/${daily.seven_days_exp ?? "-"}EXP`,
    `补签上限=${daily.makeup_limit ?? "-"}`,
  ];
  console.log(`[jm] ${parts.join(", ")}`);
}

// 当前活动: daily_id / record / makeup_limit
async function fetchDailyInfo(baseUrl, uid, jwtToken) {
  const res = await tryRequest({
    method: "GET",
    url: `${baseUrl}/daily`,
    params: { user_id: uid, lang: "TW" },
    jwt: jwtToken,
  });
  return unwrapData(res);
}

async function checkin(baseUrl, uid, jwtToken, daily) {
  const dailyId = daily?.daily_id;
  if (!dailyId) {
    throw new Error("签到数据中缺少 daily_id（可能当前没有进行中的签到活动）");
  }

  console.log(`[jm] 执行签到, daily_id=${dailyId}`);

  const chkRes = await tryRequest({
    method: "POST",
    url: `${baseUrl}/daily_chk`,
    data: new URLSearchParams({
      user_id: uid,
      daily_id: dailyId,
    }).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    jwt: jwtToken,
  });

  const msg = readMsg(chkRes);
  const state = classifySignMsg(msg);

  if (state === "already") {
    console.log(`[jm] 今天已经签到过了${msg ? `: ${msg}` : ""}`);
    return daily;
  }

  if (state === "failed") {
    throw new Error(`签到未成功: ${msg}`);
  }

  console.log(`[jm] 签到成功${msg ? `: ${msg}` : ""}`);

  // 复核今日签到状态
  let latest = null;
  try {
    latest = await fetchDailyInfo(baseUrl, uid, jwtToken);
  } catch (error) {
    console.log("[jm] 复核请求失败, 忽略:", error.message || error);
  }

  if (latest) {
    const cell = findTodayCell(latest.record, beijingToday().day);
    if (cell && cell.signed === true) {
      console.log("[jm] 复核: 今日已标记签到");
    } else if (cell) {
      throw new Error("复核失败: /daily 中今日仍未标记签到");
    } else {
      console.log("[jm] 复核: 未找到今日记录单元格, 跳过复核");
    }
  }

  return latest || daily;
}

// record: 按周分组的 { signed, bonus, date } 二维数组
function collectPendingDays(record, year, month, today) {
  const cells = Array.isArray(record) ? record.flat() : [];
  const seen = new Set();
  const days = [];

  for (const cell of cells) {
    if (!cell || typeof cell !== "object") continue;
    if (cell.signed === true) continue;

    const day = Number(cell.date);
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    if (day >= today) continue;

    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCMonth() !== month - 1) continue;

    if (seen.has(day)) continue;
    seen.add(day);
    days.push(day);
  }

  return days.sort((a, b) => a - b);
}

// 已用补签次数取自环境变量
function readMakeupUsed() {
  const used = Number(process.env.JM_MAKEUP_USED ?? 0);
  return Number.isFinite(used) && used >= 0 ? used : 0;
}

async function makeupCheckin(baseUrl, uid, jwtToken, dailyId, date) {
  const res = await tryRequest({
    method: "POST",
    url: `${baseUrl}/daily_chk`,
    data: new URLSearchParams({
      user_id: uid,
      daily_id: dailyId,
      date,
    }).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    jwt: jwtToken,
  });

  return readMsg(res);
}

async function runMakeup(baseUrl, uid, jwtToken, daily) {
  console.log("[jm] 正在检查本月补签...");

  if (!daily || typeof daily !== "object") {
    console.log("[jm] 未获取到签到数据, 跳过补签");
    return;
  }

  const dailyId = daily.daily_id;
  if (!dailyId) {
    console.log("[jm] 签到数据中没有 daily_id, 跳过补签");
    return;
  }

  const limitValue = Number(daily.makeup_limit);
  const limit = Number.isFinite(limitValue) ? limitValue : MAKEUP_LIMIT_DEFAULT;
  const used = readMakeupUsed();
  const remaining = Math.max(0, limit - used);

  const { year, month, day: today } = beijingToday();
  const pending = collectPendingDays(daily.record, year, month, today);

  console.log(
    `[jm] 本月未签到: ${pending.length ? pending.join(", ") : "无"}`
  );
  console.log(`[jm] 补签次数: 上限 ${limit}, 已用 ${used}, 剩余 ${remaining}`);

  if (pending.length === 0) {
    console.log("[jm] 无需补签");
    return;
  }

  if (remaining <= 0) {
    console.log("[jm] 补签次数已用完, 跳过补签");
    return;
  }

  const targets = pending.slice(0, remaining);
  let success = 0;

  for (const day of targets) {
    const date = formatDateParts(year, month, day);
    try {
      const msg = await makeupCheckin(baseUrl, uid, jwtToken, dailyId, date);
      if (/补签成功|補簽成功/.test(msg)) {
        success += 1;
        console.log(`[jm] 补签 ${date} 成功: ${msg}`);
      } else {
        console.log(`[jm] 补签 ${date} 失败: ${msg || "未知原因"}, 停止补签`);
        break;
      }
    } catch (error) {
      console.log(
        `[jm] 补签 ${date} 失败: ${error.message || error}, 停止补签`
      );
      break;
    }
  }

  console.log(`[jm] 补签完成: 成功 ${success}/${targets.length}`);
}

async function main() {
  const account = process.env.JM_ACCOUNT;
  const password = process.env.JM_PASSWORD;

  if (!account || !password) {
    console.error("错误: 请在 GitHub Secrets 中设置 JM_ACCOUNT 和 JM_PASSWORD");
    process.exit(1);
  }

  let failed = false;
  let daily = null;

  try {
    const baseUrl = await resolveBaseUrl();
    const { jwtToken, uid } = await login(baseUrl, account, password);

    try {
      daily = await fetchDailyInfo(baseUrl, uid, jwtToken);
      logDailySummary(daily);
      daily = (await checkin(baseUrl, uid, jwtToken, daily)) || daily;
    } catch (error) {
      failed = true;
      console.error("[jm] 签到失败:", error.message || error);
    }

    try {
      await runMakeup(baseUrl, uid, jwtToken, daily);
    } catch (error) {
      console.warn("[jm] 补签流程异常:", error.message || error);
    }
  } catch (error) {
    failed = true;
    console.error("[jm] 签到任务失败:", error.message || error);
  }

  if (failed) {
    console.error("[jm] 每日签到任务未完成");
    process.exitCode = 1;
    return;
  }

  console.log("[jm] 每日签到任务完成");
}

main();
