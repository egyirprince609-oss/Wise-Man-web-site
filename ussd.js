const express = require("express");
const serverless = require("serverless-http");

const app = express();
app.use(express.json({limit:"100kb"}));
app.use(express.urlencoded({extended:false,limit:"100kb"}));

const API = "https://netpluse.shop/api/v1";
const KEY = process.env.NETPULSE_API_KEY || "";

function phone(v=""){
  v=String(v).trim();
  if(/^0\d{9}$/.test(v)) return v;
  if(/^233\d{9}$/.test(v)) return "0"+v.slice(3);
  if(/^\+233\d{9}$/.test(v)) return "0"+v.slice(4);
  return v;
}
function inputs(v=""){
  v=String(v||"").trim();
  if(!v || (v.startsWith("*")&&v.endsWith("#"))) return [];
  return v.split("*").map(x=>x.trim()).filter(Boolean);
}
function jsonMode(req){
  return req.is("application/json") || req.body?.sessionID!==undefined ||
    req.body?.sessionId!==undefined || req.body?.userData!==undefined;
}
function reply(req,res,message,cont){
  const b=req.body||{};
  const sessionID=b.sessionID||b.sessionId||"";
  const userID=b.userID||"";
  const msisdn=b.msisdn||b.phoneNumber||"";
  if(jsonMode(req)) return res.status(200).json({sessionID,userID,msisdn,message,continueSession:cont});
  return res.type("text/plain").status(200).send(`${cont?"CON":"END"} ${message}`);
}
async function packages(){
  if(!KEY) throw new Error("NETPULSE_API_KEY is not configured");
  const r=await fetch(`${API}/packages`,{headers:{"x-api-key":KEY,"Accept":"application/json"}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d?.error||`NetPulse HTTP ${r.status}`);
  return Array.isArray(d.packages)?d.packages:[];
}

app.get("/",(req,res)=>res.json({ok:true,service:"Wise Man USSD Function",status:"online"}));
app.get("/health",(req,res)=>res.json({ok:true}));

app.post("/",async(req,res)=>{
  try{
    const b=req.body||{};
    const raw=b.userData!==undefined?b.userData:(b.text!==undefined?b.text:"");
    const a=inputs(raw), first=a[0];

    if(!a.length) return reply(req,res,"WISE MAN DATA\n1. Buy Data\n2. Prices\n3. Help\n0. Exit",true);
    if(first==="0") return reply(req,res,"Thank you for using Wise Man Data.",false);

    if(first==="2"){
      try{
        const ps=await packages();
        if(!ps.length) return reply(req,res,"Prices are temporarily unavailable. Please try again.",false);
        const lines=ps.slice(0,6).map((p,i)=>`${i+1}. ${p.network} ${p.capacity} GHS ${Number(p.price).toFixed(2)}`);
        return reply(req,res,`DATA PRICES\n${lines.join("\n")}\n0. Back`,true);
      }catch(e){ console.error(e); return reply(req,res,"Unable to load prices now. Please try again.",false); }
    }

    if(first==="3") return reply(req,res,"HELP\nBuy Data: choose network, bundle and recipient number.\nSupport: Wise Man",false);

    const nets={"1":"MTN","2":"Telecel","3":"AirtelTigo"};

    if(first==="1" && a.length===1)
      return reply(req,res,"SELECT NETWORK\n1. MTN\n2. Telecel\n3. AirtelTigo\n0. Back",true);

    if(first==="1" && a.length===2){
      if(a[1]==="0") return reply(req,res,"WISE MAN DATA\n1. Buy Data\n2. Prices\n3. Help\n0. Exit",true);
      const n=nets[a[1]];
      if(!n) return reply(req,res,"Invalid network. Try again.",false);
      try{
        const ps=(await packages()).filter(p=>String(p.network).toUpperCase()===n.toUpperCase());
        if(!ps.length) return reply(req,res,`${n} bundles unavailable right now.`,false);
        return reply(req,res,`${n} DATA\n${ps.slice(0,7).map((p,i)=>`${i+1}. ${p.capacity} GHS ${Number(p.price).toFixed(2)}`).join("\n")}\n0. Back`,true);
      }catch(e){ console.error(e); return reply(req,res,"Bundles are temporarily unavailable.",false); }
    }

    if(first==="1" && a.length===3){
      const n=nets[a[1]]; if(!n) return reply(req,res,"Invalid network.",false);
      try{
        const ps=(await packages()).filter(p=>String(p.network).toUpperCase()===n.toUpperCase());
        const p=ps[Number(a[2])-1]; if(!p) return reply(req,res,"Invalid bundle. Please try again.",false);
        return reply(req,res,`${n} ${p.capacity} GHS ${Number(p.price).toFixed(2)}\nEnter recipient number:`,true);
      }catch(e){ console.error(e); return reply(req,res,"Unable to check that bundle now.",false); }
    }

    if(first==="1" && a.length===4){
      const n=nets[a[1]], to=phone(a[3]);
      if(!n || !/^0\d{9}$/.test(to)) return reply(req,res,"Invalid recipient number. Use 0241234567 format.",false);
      try{
        const ps=(await packages()).filter(p=>String(p.network).toUpperCase()===n.toUpperCase());
        const p=ps[Number(a[2])-1]; if(!p) return reply(req,res,"Bundle not found. Please start again.",false);
        return reply(req,res,`CONFIRM\n${n} ${p.capacity}\nTo: ${to}\nPrice: GHS ${Number(p.price).toFixed(2)}\n1. Continue\n2. Cancel`,true);
      }catch(e){ console.error(e); return reply(req,res,"Unable to prepare confirmation.",false); }
    }

    if(first==="1" && a.length===5){
      if(a[4]==="2") return reply(req,res,"Purchase cancelled.",false);
      if(a[4]==="1") return reply(req,res,"Payment is not connected yet. This test build will not charge or purchase data.",false);
    }

    return reply(req,res,"Invalid option. Please dial again.",false);
  }catch(e){
    console.error("USSD error:",e);
    return reply(req,res,"Service temporarily unavailable. Please try again.",false);
  }
});
module.exports.handler=serverless(app);
