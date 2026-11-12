require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const Stripe = require("stripe");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(process.env.DB_FILE || path.join(__dirname, "shoeline.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, brand TEXT NOT NULL,
 category TEXT NOT NULL, price INTEGER NOT NULL, compare_at INTEGER DEFAULT 0,
 sku TEXT UNIQUE, inventory INTEGER NOT NULL DEFAULT 50, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 order_number TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending_payment',
 total INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'php',
 stripe_session_id TEXT, shipping_name TEXT, shipping_email TEXT,
 shipping_address TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id),
 product_id INTEGER NOT NULL REFERENCES products(id), product_name TEXT NOT NULL,
 unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS return_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
 order_id INTEGER NOT NULL REFERENCES orders(id), reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'requested', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS quote_requests (
 id INTEGER PRIMARY KEY AUTOINCREMENT, organization TEXT NOT NULL,
 email TEXT NOT NULL, quantity INTEGER NOT NULL, notes TEXT,
 user_id INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);
const seed = [
[1,"Air Pulse Runner","Nike","Men",389000,459000,"SL-NK-001",50],
[2,"Cloudfoam Street","Adidas","Women",329000,0,"SL-AD-002",50],
[3,"Retro Court 80","New Balance","Men",419000,499000,"SL-NB-003",50],
[4,"Everyday Canvas","Converse","Kids",189000,0,"SL-CV-004",50],
[5,"Velocity Pro","Puma","Men",299000,359000,"SL-PM-005",50],
[6,"SoftStep Knit","Asics","Women",349000,0,"SL-AS-006",50],
[7,"Mini Motion","Nike","Kids",219000,259000,"SL-NK-007",50],
[8,"Studio Classic","Adidas","Women",279000,329000,"SL-AD-008",50]
];
const insertProduct = db.prepare("INSERT OR IGNORE INTO products (id,name,brand,category,price,compare_at,sku,inventory) VALUES (?,?,?,?,?,?,?,?)");
seed.forEach(p=>insertProduct.run(...p));

const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;

// Stripe webhook must be before express.json() to preserve the raw payload for signature verification.
app.post("/api/stripe/webhook", express.raw({type:"application/json"}), (req,res)=>{
  if(!stripe) return res.status(503).send("Stripe is not configured");
  const signature=req.headers["stripe-signature"];
  let event;
  try { event=stripe.webhooks.constructEvent(req.body,signature,process.env.STRIPE_WEBHOOK_SECRET); }
  catch(err){ return res.status(400).send(`Webhook signature error: ${err.message}`); }
  if(event.type==="checkout.session.completed"){
    const sessionObj=event.data.object;
    const orderId=Number(sessionObj.metadata && sessionObj.metadata.orderId);
    if(orderId) db.prepare("UPDATE orders SET status='paid', stripe_session_id=? WHERE id=?").run(sessionObj.id,orderId);
  } else if(event.type==="checkout.session.expired"){
    const sessionObj=event.data.object;
    const orderId=Number(sessionObj.metadata && sessionObj.metadata.orderId);
    if(orderId) db.prepare("UPDATE orders SET status='checkout_expired' WHERE id=? AND status='pending_payment'").run(orderId);
  }
  res.json({received:true});
});

app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:"100kb"}));
app.use(session({
  store: new SQLiteStore({db:"sessions.sqlite",dir:__dirname}),
  name:"shoeline.sid",
  secret:process.env.SESSION_SECRET || "replace-this-development-secret-before-deploy",
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:7*24*60*60*1000}
}));
app.use("/api/auth",rateLimit({windowMs:15*60*1000,max:30,standardHeaders:true,legacyHeaders:false}));
app.use(express.static(path.join(__dirname,"public")));

const safeUser = u => ({id:u.id,name:u.name,email:u.email});
function requireAuth(req,res,next){if(!req.session.userId)return res.status(401).json({error:"Please sign in first."});next();}
function validEmail(email){return typeof email==="string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);}
function getUser(req){return db.prepare("SELECT id,name,email FROM users WHERE id=?").get(req.session.userId);}

app.get("/api/health",(req,res)=>res.json({status:"ok",app:"Shoeline"}));
app.get("/api/products",(req,res)=>res.json({products:db.prepare("SELECT id,name,brand,category,price,compare_at,sku,inventory FROM products WHERE active=1").all()}));
app.post("/api/auth/register",async(req,res)=>{
  const {name,email,password}=req.body||{};
  if(!name||name.trim().length<2||!validEmail(email)||typeof password!=="string"||password.length<10)
    return res.status(400).json({error:"Enter a name, valid email, and password with at least 10 characters."});
  try{
    const hash=await bcrypt.hash(password,12);
    const result=db.prepare("INSERT INTO users(name,email,password_hash) VALUES(?,?,?)").run(name.trim(),email.toLowerCase(),hash);
    req.session.userId=result.lastInsertRowid;
    res.status(201).json({user:safeUser(getUser(req))});
  }catch(e){if(String(e).includes("UNIQUE"))return res.status(409).json({error:"An account with this email already exists."});res.status(500).json({error:"Could not create account."});}
});
app.post("/api/auth/login",async(req,res)=>{
  const {email,password}=req.body||{};
  if(!validEmail(email)||typeof password!=="string")return res.status(400).json({error:"Enter your email and password."});
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(email.toLowerCase());
  if(!u||!(await bcrypt.compare(password,u.password_hash)))return res.status(401).json({error:"Invalid email or password."});
  req.session.regenerate(err=>{if(err)return res.status(500).json({error:"Could not start session."});req.session.userId=u.id;res.json({user:safeUser(u)});});
});
app.get("/api/auth/me",(req,res)=>{if(!req.session.userId)return res.json({user:null});const u=getUser(req);res.json({user:u?safeUser(u):null});});
app.post("/api/auth/logout",(req,res)=>req.session.destroy(()=>{res.clearCookie("shoeline.sid");res.json({ok:true});}));

app.post("/api/checkout/create-session",requireAuth,async(req,res)=>{
  if(!stripe)return res.status(503).json({error:"Stripe is not configured yet. Add STRIPE_SECRET_KEY to .env."});
  const items=req.body && req.body.items;
  if(!Array.isArray(items)||!items.length)return res.status(400).json({error:"Your cart is empty."});
  const ids=[...new Set(items.map(x=>Number(x.id)))];
  const dbProducts=db.prepare(`SELECT id,name,price,inventory FROM products WHERE active=1 AND id IN (${ids.map(()=>"?").join(",")})`).all(...ids);
  const byId=new Map(dbProducts.map(p=>[p.id,p]));
  const clean=[];
  for(const item of items){
    const p=byId.get(Number(item.id)), qty=Number(item.qty);
    if(!p||!Number.isInteger(qty)||qty<1||qty>20)return res.status(400).json({error:"Invalid product or quantity."});
    if(p.inventory<qty)return res.status(409).json({error:`Not enough stock for ${p.name}.`});
    clean.push({product:p,qty});
  }
  const total=clean.reduce((sum,x)=>sum+x.product.price*x.qty,0);
  const orderNumber="SL-"+Date.now().toString(36).toUpperCase();
  const tx=db.transaction(()=>{
    const order=db.prepare("INSERT INTO orders(user_id,order_number,total,currency,status) VALUES(?,?,?,'php','pending_payment')").run(req.session.userId,orderNumber,total);
    const orderId=Number(order.lastInsertRowid);
    const insert=db.prepare("INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES(?,?,?,?,?)");
    clean.forEach(x=>insert.run(orderId,x.product.id,x.product.name,x.product.price,x.qty));
    return orderId;
  });
  const orderId=tx();
  try{
    const checkout=await stripe.checkout.sessions.create({
      mode:"payment",
      payment_method_types:["card"],
      line_items:clean.map(x=>({price_data:{currency:"php",product_data:{name:x.product.name,description:`Shoeline SKU ${x.product.id}`},unit_amount:x.product.price},quantity:x.qty})),
      success_url:`${process.env.BASE_URL || `http://localhost:${PORT}`}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:`${process.env.BASE_URL || `http://localhost:${PORT}`}/?checkout=cancel`,
      client_reference_id:String(orderId),
      metadata:{orderId:String(orderId),userId:String(req.session.userId)}
    });
    db.prepare("UPDATE orders SET stripe_session_id=? WHERE id=?").run(checkout.id,orderId);
    res.json({url:checkout.url});
  }catch(e){db.prepare("UPDATE orders SET status='checkout_error' WHERE id=?").run(orderId);res.status(502).json({error:"Could not create Stripe Checkout session. Check Stripe configuration."});}
});

app.get("/api/orders",requireAuth,(req,res)=>{
  const orders=db.prepare("SELECT id,order_number AS orderNumber,status,total,currency,created_at AS date FROM orders WHERE user_id=? ORDER BY id DESC").all(req.session.userId);
  const items=db.prepare("SELECT order_id,product_name AS name,quantity AS qty,unit_price AS price FROM order_items WHERE order_id=?");
  res.json({orders:orders.map(o=>({...o,total:o.total/100,items:items.all(o.id)}))});
});
app.post("/api/returns",requireAuth,(req,res)=>{
  const {orderId,reason}=req.body||{};
  const order=db.prepare("SELECT id FROM orders WHERE order_number=? AND user_id=?").get(orderId,req.session.userId);
  if(!order||!reason)return res.status(400).json({error:"Select one of your orders and a return reason."});
  const result=db.prepare("INSERT INTO return_requests(user_id,order_id,reason) VALUES(?,?,?)").run(req.session.userId,order.id,String(reason).slice(0,500));
  res.status(201).json({id:result.lastInsertRowid,status:"requested"});
});
app.post("/api/quotes",(req,res)=>{
  const {organization,email,quantity,notes}=req.body||{};
  if(!organization||!validEmail(email)||!Number.isInteger(Number(quantity))||Number(quantity)<1)return res.status(400).json({error:"Enter an organization, valid email, and quantity."});
  const result=db.prepare("INSERT INTO quote_requests(organization,email,quantity,notes,user_id) VALUES(?,?,?,?,?)").run(String(organization).slice(0,150),email,Number(quantity),String(notes||"").slice(0,2000),req.session.userId||null);
  res.status(201).json({id:result.lastInsertRowid});
});

app.get("/success",(req,res)=>res.redirect("/?checkout=success"));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`Shoeline running at http://localhost:${PORT}`));
