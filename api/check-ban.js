\
import { HttpsProxyAgent } from "https-proxy-agent";

const UA_LIST = [
  "WhatsApp/2.23.8.76 Android/13 Device/Pixel",
  "WhatsApp/2.22.18 Android/12 Device/Generic",
  "WhatsApp/2.21.23 Android/11 Device/Samsung",
  "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) WhatsApp/2.21.23"
];

const MCC_OPTIONS = ["510","440","310","404","505","520"];
const MNC_OPTIONS = ["00","01","10","20","70","01"];
const DEFAULT_RATE_LIMIT = parseInt(process.env.RATE_LIMIT_PER_MIN || "30", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "2", 10);

const rateMap = new Map();

function nowUnix(){ return Math.floor(Date.now()/1000); }

function allowedByRateLimit(ip){
  const windowLen = 60;
  const limit = DEFAULT_RATE_LIMIT;
  const cur = nowUnix();
  const rec = rateMap.get(ip);
  if(!rec){ rateMap.set(ip, {count:1, windowStart:cur}); return true; }
  if(cur - rec.windowStart >= windowLen){ rateMap.set(ip, {count:1, windowStart:cur}); return true; }
  if(rec.count < limit){ rec.count += 1; return true; }
  return false;
}

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function normalizeNumber(input){
  if(!input || typeof input !== "string") return null;
  const s = input.trim();
  const plus = s.startsWith("+") ? s.slice(1) : s;
  if(!/^\d{6,15}$/.test(plus)) return null;
  let cc = plus.slice(0,2);
  if(plus.length < 8) cc = plus.slice(0,1);
  cc = cc.replace(/^0+/, "") || plus.slice(0,1);
  const inPart = plus.slice(cc.length);
  if(!inPart) return null;
  return { cc, in: inPart };
}

function buildFormBody({ cc, inPart, method="sms", mcc, mnc }){
  const params = new URLSearchParams();
  params.append("cc", cc);
  params.append("in", inPart);
  params.append("method", method);
  if(mcc) params.append("mcc", mcc);
  if(mnc) params.append("mnc", mnc);
  params.append("r", Math.floor(Math.random()*1000000).toString());
  return params.toString();
}

// Detection regex tuned to APK strings found (banned, change_number_new_number_banned, account suspended, bad-token)
const BANNED_REGEX = /(change_number_new_number_banned|account suspended|account banned|forbidden|bann(?:ed|ing)|blocked|bad-token|auth_failed|auth_failure)/i;
const OK_REGEX = /("status"\s*:\s*"ok"|"code"\s*:\s*"0"|code.*ok|status.*ok)/i;

async function doRegisterCheck(numberObj, proxyUrl, retries=0){
  const ua = pickRandom(UA_LIST);
  const mcc = pickRandom(MCC_OPTIONS);
  const mnc = pickRandom(MNC_OPTIONS);
  const body = buildFormBody({ cc: numberObj.cc, inPart: numberObj.in, method: "sms", mcc, mnc });
  const endpoint = "https://v.whatsapp.net/v2/register";

  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": ua,
    "Accept": "*/*",
    "Connection": "keep-alive"
  };

  const fetchOptions = { method: "POST", headers, body };

  if(proxyUrl){
    try { fetchOptions.agent = new HttpsProxyAgent(proxyUrl); } catch(e){ console.warn("proxy agent fail", e); }
  }

  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(), 12000);
  fetchOptions.signal = controller.signal;

  try{
    const resp = await fetch(endpoint, fetchOptions);
    clearTimeout(timeout);
    const text = await resp.text();
    const low = (text||"").toLowerCase();

    if(BANNED_REGEX.test(low) || resp.status === 403 || resp.status === 401){
      return { banned: true, raw: text, status: resp.status };
    }
    if(OK_REGEX.test(low) || (resp.status >=200 && resp.status < 300)){
      return { banned: false, raw: text, status: resp.status };
    }
    if(resp.status >=400 && resp.status < 500){
      if(BANNED_REGEX.test(low)) return { banned: true, raw: text, status: resp.status };
    }
    return { banned: false, raw: text, status: resp.status };
  }catch(err){
    clearTimeout(timeout);
    if(retries < MAX_RETRIES){
      await new Promise(r=>setTimeout(r, 500 + Math.floor(Math.random()*700)));
      return doRegisterCheck(numberObj, proxyUrl, retries+1);
    }
    return { error: "network_error", message: String(err) };
  }
}

export default async function handler(req, res){
  if(req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
  if(!allowedByRateLimit(ip)) return res.status(429).json({ error: "rate_limited", message: `Too many requests (limit ${DEFAULT_RATE_LIMIT}/min)` });

  let body;
  try { body = req.body && typeof req.body === "object" ? req.body : JSON.parse(await req.text().catch(()=>"{}")); } catch(e){ body = {}; }
  const number = (body.number || body.phone || "").toString().trim();
  if(!number) return res.status(400).json({ error: "number_required", message: "Send { number: \"+6281234...\" } in request body" });

  const normalized = normalizeNumber(number);
  if(!normalized) return res.status(400).json({ error: "invalid_number", message: "Number must be digits with country code (E.164 recommended)." });

  const proxiesEnv = process.env.PROXIES || "";
  const proxies = proxiesEnv.split("\\n").map(s=>s.trim()).filter(Boolean);
  let proxyToUse = undefined;
  if(proxies.length > 0) proxyToUse = pickRandom(proxies);

  const result = await doRegisterCheck({ cc: normalized.cc, in: normalized.in }, proxyToUse);

  if(result && result.error) return res.status(502).json({ error: "proxy_or_network_failed", details: result });

  const out = {
    number,
    normalized,
    banned: !!result.banned,
    statusCode: result.status,
    proxy: proxyToUse ? "used" : "none"
  };
  if(process.env.EXPOSE_RAW === "1") out.raw = result.raw;
  return res.status(200).json(out);
}
