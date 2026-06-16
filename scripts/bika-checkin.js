const axios = require("axios");
const crypto = require("crypto");

const API_KEY = "C69BAF41DA5ABD1FFEDC6D2FEA56B";
const SECRET_KEY =
  "~d}$Q7$eIni=V)9\\RK/P.RM4;9[7|@/CA}b~OW!3?EV`:<>M7pddUBL5n|0/*Cn";

const DEFAULT_API_BASE = "https://picaapi.picacomic.com/";
const BACKUP_API_BASE = "https://picaapi.go2778.com/";

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomHex(len) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

function cleanPath(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return `${parsed.pathname}${parsed.search}`.replace(/^\/+/, "");
    } catch {
      // ignore
    }
  }
  return value
    .replace(DEFAULT_API_BASE, "")
    .replace(BACKUP_API_BASE, "")
    .replace(/^\/+/, "");
}

function createSignature(path, timestamp, nonce, method) {
  const raw = `${path}${timestamp}${nonce}${method}${API_KEY}`.toLowerCase();
  return crypto.createHmac("sha256", SECRET_KEY).update(raw).digest("hex");
}

function buildHeaders({ method, url, authorization = "" }) {
  const path = cleanPath(url);
  const timestamp = nowSeconds();
  const nonce = randomHex(32);
  const signature = createSignature(path, timestamp, nonce, method);

  const headers = {
    "api-key": API_KEY,
    accept: "application/vnd.picacomic.com.v1+json",
    "app-channel": "3",
    time: String(timestamp),
    nonce: nonce,
    signature: signature,
    "app-version": "2.2.1.3.3.4",
    "app-uuid": "defaultUuid",
    "app-platform": "android",
    "app-build-version": "45",
    "accept-encoding": "gzip",
    "user-agent": "okhttp/3.8.1",
    "content-type": "application/json; charset=UTF-8",
    "image-quality": "original",
  };

  if (authorization) {
    headers.authorization = authorization;
  }

  return headers;
}

async function bikaRequest({ apiBase, method, url, body, authorization }) {
  const fullUrl = url.startsWith("http") ? url : `${apiBase}${url}`;
  const headers = buildHeaders({ method, url: fullUrl, authorization });

  const response = await axios({
    method,
    url: fullUrl,
    headers,
    data: body ?? {},
    timeout: 15000,
    validateStatus: () => true,
  });

  const data = response.data;

  if (response.status < 200 || response.status >= 300) {
    const msg = data?.message || data?.errorMsg || `HTTP ${response.status}`;
    throw new Error(msg);
  }

  if (data?.code === 401) {
    throw new Error("unauthorized");
  }

  return data;
}

async function tryWithFallback(requestFn) {
  const bases = [DEFAULT_API_BASE, BACKUP_API_BASE];
  let lastError;
  for (const base of bases) {
    try {
      return await requestFn(base);
    } catch (err) {
      lastError = err;
      console.log(`[bika] API ${base} 请求失败: ${err.message || err}`);
    }
  }
  throw lastError;
}

async function login(account, password) {
  console.log("[bika] 正在登录...");
  const data = await tryWithFallback((apiBase) =>
    bikaRequest({
      apiBase,
      method: "POST",
      url: "auth/sign-in",
      body: { email: account, password },
    })
  );

  const token = String(data?.data?.token ?? "");
  if (!token) {
    throw new Error(`登录失败: ${data?.message || "未知错误"}`);
  }
  console.log("[bika] 登录成功");
  return token;
}

async function getUserProfile(token) {
  const data = await tryWithFallback((apiBase) =>
    bikaRequest({
      apiBase,
      method: "GET",
      url: "users/profile",
      authorization: token,
    })
  );

  const user = data?.data?.user ?? {};
  const name = String(user?.name ?? "");
  const level = Number(user?.level ?? 0);
  const exp = Number(user?.exp ?? 0);
  const title = String(user?.title ?? "");

  if (name) {
    console.log(`[bika] 用户: ${name}`);
  }
  console.log(`[bika] 等级: Lv.${level}${title ? ` (${title})` : ""}`);
  console.log(`[bika] 当前经验值: ${exp}`);

  return { name, level, exp, title };
}

async function checkin(token) {
  console.log("[bika] 正在签到...");
  const data = await tryWithFallback((apiBase) =>
    bikaRequest({
      apiBase,
      method: "POST",
      url: "users/punch-in",
      body: {},
      authorization: token,
    })
  );

  const status = data?.data?.res?.status;
  if (data?.code === 200 && status && status !== "fail") {
    console.log("[bika] 签到成功");
    return true;
  }

  const msg = data?.message || data?.errorMsg || "";
  if (data?.code === 200 && msg.toLowerCase() === "success") {
    console.log("[bika] 签到成功");
    return true;
  }

  if (msg.includes("already") || msg.includes("已签到")) {
    console.log("[bika] 今天已经签到过了");
    return true;
  }

  throw new Error(`签到失败: ${msg || JSON.stringify(data)}`);
}

async function main() {
  const account = process.env.BIKA_ACCOUNT;
  const password = process.env.BIKA_PASSWORD;

  if (!account || !password) {
    console.error("错误: 请在 GitHub Secrets 中设置 BIKA_ACCOUNT 和 BIKA_PASSWORD");
    process.exit(1);
  }

  try {
    const token = await login(account, password);
    await getUserProfile(token);
    await checkin(token);
    console.log("[bika] 每日签到任务完成");
  } catch (error) {
    console.error("[bika] 签到任务失败:", error.message || error);
    process.exit(1);
  }
}

main();
