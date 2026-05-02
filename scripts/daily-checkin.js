import axios from "axios";
import CryptoJS from "crypto-js";

const JM_VERSION = "2.0.13";
const JM_SECRET = "185Hcomic3PAPP7R";

const BASE_URLS = [
  "https://www.cdnsha.org",
  "https://www.cdnbea.cc",
  "https://www.cdnbea.net",
  "https://www.cdn-mspjmapiproxy.xyz",
];

function nowTs() {
  return String(Date.now());
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
        try {
          const key = md5Hex(`${ts}${JM_SECRET}`);
          const decrypted = aesEcbDecrypt(normalizedB64, key);
          if (decrypted.trim()) {
            try {
              return JSON.parse(decrypted.trim());
            } catch {
              return decrypted.trim();
            }
          }
        } catch {
          // ignore
        }
      }
      try {
        return JSON.parse(rawData);
      } catch {
        return rawData;
      }
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
    // Node.js Buffer (axios 在 Node 环境下返回的是 Buffer 而不是 ArrayBuffer)
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
    const msg =
      decoded?.errorMsg || decoded?.msg || decoded?.message || `HTTP ${status}`;
    throw new Error(msg);
  }

  return decoded;
}

async function getFastestBaseUrl() {
  for (const url of BASE_URLS) {
    try {
      const res = await axios.get(url, { timeout: 5000, validateStatus: () => true });
      if (res.status < 500) {
        console.log(`[jm] 使用 API 域名: ${url}`);
        return url;
      }
    } catch {
      // try next
    }
  }
  return BASE_URLS[0];
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

  console.log("[jm] 登录响应:", JSON.stringify(result, null, 2));

  // 处理两种响应结构:
  // 1. 明文: {code: 200, data: {jwttoken: "xxx", uid: "xxx"}}
  // 2. 解密后: {jwttoken: "xxx", uid: "xxx"}
  const dataObj = result?.data && typeof result.data === "object" ? result.data : result;
  const jwtToken = String(dataObj?.jwttoken || "").trim();
  const uid = String(dataObj?.uid || "").trim();

  if (!jwtToken) {
    const errorMsg = result?.errorMsg || result?.msg || "未获取到 jwtToken";
    throw new Error(`登录失败: ${errorMsg}`);
  }

  console.log(`[jm] 登录成功, uid=${uid}`);
  return { jwtToken, uid, userInfo: result };
}

async function checkin(baseUrl, uid, jwtToken) {
  console.log("[jm] 正在获取每日签到列表...");

  const dailyListRes = await tryRequest({
    method: "POST",
    url: `${baseUrl}/daily_list/filter`,
    data: new URLSearchParams({
      data: String(new Date().getFullYear()),
    }).toString(),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    jwt: jwtToken,
  });

  const list = dailyListRes?.data?.list ?? dailyListRes?.list ?? [];
  if (!Array.isArray(list) || list.length === 0) {
    console.log("[jm] 今日无签到项");
    return true;
  }

  const lastItem = list[list.length - 1];
  const dailyId = lastItem?.id;
  if (!dailyId) {
    throw new Error("无法获取 dailyId");
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

  const msg = chkRes?.data?.msg ?? chkRes?.msg ?? "";
  console.log(`[jm] 签到结果: ${msg || "成功"}`);

  if (msg === "今天已经签到过了") {
    console.log("[jm] 今天已经签到过了");
  } else {
    console.log("[jm] 签到成功！");
  }

  return true;
}

async function main() {
  const account = process.env.JM_ACCOUNT;
  const password = process.env.JM_PASSWORD;

  if (!account || !password) {
    console.error("错误: 请在 GitHub Secrets 中设置 JM_ACCOUNT 和 JM_PASSWORD");
    process.exit(1);
  }

  try {
    const baseUrl = await getFastestBaseUrl();
    const { jwtToken, uid } = await login(baseUrl, account, password);
    await checkin(baseUrl, uid, jwtToken);
    console.log("[jm] 每日签到任务完成");
  } catch (error) {
    console.error("[jm] 签到任务失败:", error.message || error);
    process.exit(1);
  }
}

main();
