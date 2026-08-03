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

  // 非 GET 请求一律携带 JSON 请求体（缺失时默认空对象 {}），
  // 哔咔 punch-in 等接口必须发送空对象 {}，否则服务端返回 res.status:"fail"
  const requestConfig = {
    method,
    url: fullUrl,
    headers,
    timeout: 15000,
    validateStatus: () => true,
  };
  const requestBody = body !== undefined && body !== null ? body : {};
  requestConfig.data = requestBody;

  const response = await axios(requestConfig);

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
      // 哔咔 punch-in 接口必须携带空 JSON 对象 {} 请求体，
      // 否则服务端返回 data.res.status:"fail"
      body: {},
      authorization: token,
    })
  );

  console.log("[bika] 签到 API 响应:", JSON.stringify(data));

  const status = data?.data?.res?.status;
  if (status === "ok") {
    const punchInLastDay = data?.data?.res?.punchInLastDay ?? "?";
    console.log(`[bika] 签到成功 (最近签到: ${punchInLastDay})`);
    return true;
  }

  // status 为 "fail" 时可能是"今日已签到"（幂等），也可能是真实失败，
  // 通过 users/profile 的 isPunched 字段二次确认
  if (status === "fail") {
    const profile = await tryWithFallback((apiBase) =>
      bikaRequest({
        apiBase,
        method: "GET",
        url: "users/profile",
        authorization: token,
      })
    );
    if (profile?.data?.user?.isPunched === true) {
      console.log("[bika] 今天已经签到过了");
      return true;
    }
    throw new Error(`签到失败: ${JSON.stringify(data)}`);
  }

  // 兜底：兼容其他成功格式（"already" 等提示）
  const msg = data?.message || data?.errorMsg || "";
  if (msg.includes("already") || msg.includes("已签到") || msg.includes("已经")) {
    console.log("[bika] 今天已经签到过了");
    return true;
  }

  // 注意：data.message 通常是 "success"（HTTP 层消息），不能作为失败原因，
  // 因此直接输出完整响应便于排查
  throw new Error(`签到失败: ${JSON.stringify(data)}`);
}

async function verifyCheckinStatus(token) {
  console.log("[bika] 正在验证签到状态...");
  const data = await tryWithFallback((apiBase) =>
    bikaRequest({
      apiBase,
      method: "GET",
      url: "users/profile",
      authorization: token,
    })
  );

  const isPunched = data?.data?.user?.isPunched;
  if (isPunched === true) {
    console.log("[bika] 签到状态验证通过: 今日已签到 ✓");
    return true;
  }
  if (isPunched === false) {
    console.warn("[bika] 签到状态验证失败: 今日未签到 ✗");
    return false;
  }
  // 部分 API 版本 profile 不返回 isPunched 字段，此时不阻塞任务
  console.warn("[bika] profile 未返回 isPunched 字段，跳过状态验证");
  return true;
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
    const verified = await verifyCheckinStatus(token);
    if (!verified) {
      console.error("[bika] 签到验证失败: users/profile 显示 isPunched 不为 true，实际可能未签到");
      process.exit(1);
    }
    console.log("[bika] 每日签到任务完成");
  } catch (error) {
    console.error("[bika] 签到任务失败:", error.message || error);
    process.exit(1);
  }
}

main();
