import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

const app = new Hono();
const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
const digest = async value => hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
const random = () => crypto.randomUUID();
const token = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const equal = (a, b) => { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0; };
const hashPassword = async (password, salt) => hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:enc.encode(salt),iterations:310000,hash:'SHA-256'}, await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']),256));
const isEmail = s => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const clean = (s,max) => typeof s === 'string' ? s.trim().slice(0,max) : '';
const publicUser = u => ({id:u.id,email:u.email,name:u.name,role:u.role});
const log = (c, action, target) => c.env.DB.prepare('INSERT INTO audit_log (id,actor_id,action,target_id) VALUES (?,?,?,?)').bind(random(),c.get('user')?.id ?? null,action,target ?? null).run();
const fail = (c,status,msg) => c.json({error:msg},status);
const cookieOptions = c => ({httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Strict',path:'/',maxAge:43200});

app.use('/api/*', async (c,next) => {
  c.header('Cache-Control','no-store');
  c.header('X-Content-Type-Options','nosniff');
  if (!['GET','HEAD','OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin !== new URL(c.req.url).origin) return fail(c,403,'Invalid origin');
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) return fail(c,415,'JSON required');
  }
  await next();
});
app.onError((err,c) => { console.error(err); return fail(c,500,'Internal error'); });
async function body(c) {
  const max=16384;
  if (+c.req.header('content-length') > max) return null;
  const reader=c.req.raw.body?.getReader();
  if (!reader) return null;
  const chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();return null;}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
    const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    return obj && typeof obj==='object' && !Array.isArray(obj) ? obj : null;
  }catch{return null;}
}
const auth = async (c,next) => {
  const t = getCookie(c,'gic_session');
  if (!t || !/^[0-9a-f]{64}$/.test(t)) return fail(c,401,'Login required');
  const u = await c.env.DB.prepare('SELECT u.id,u.email,u.name,u.role FROM users u JOIN sessions s ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?').bind(await digest(t),Date.now()).first();
  if (!u) return fail(c,401,'Session expired');
  c.set('user',u);
  await next();
};
const admin = async (c,next) => c.get('user').role==='admin' ? next() : fail(c,403,'Admin required');
const validPassword = p => typeof p==='string' && p.length>=12 && p.length<=128;

app.get('/api/health', c=>c.json({ok:true}));
app.get('/api/setup-status', async c=>c.json({initialized:!!(await c.env.DB.prepare("SELECT value FROM settings WHERE key='bootstrapped'").first())}));
app.post('/api/bootstrap', async c=>{
  if (!c.env.BOOTSTRAP_SECRET || c.env.BOOTSTRAP_SECRET.length<32) return fail(c,503,'Bootstrap not configured');
  const b=await body(c);
  if (!b || typeof b.secret!=='string' || !equal(b.secret,c.env.BOOTSTRAP_SECRET)) return fail(c,403,'Forbidden');
  const email=clean(b.email,254).toLowerCase(), name=clean(b.name,100);
  if (!isEmail(email)||!name||!validPassword(b.password)) return fail(c,400,'Invalid account');
  const id=random(),salt=token(),passwordHash=await hashPassword(b.password,salt);
  try {
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO settings(key,value) VALUES ('bootstrapped','1')"),
      c.env.DB.prepare("INSERT INTO users (id,email,name,role,salt,password_hash) VALUES (?,?,?,'admin',?,?)").bind(id,email,name,salt,passwordHash)
    ]);
  } catch { return fail(c,409,'Already initialized'); }
  await log(c,'bootstrap',id);
  return c.json({ok:true},201);
});
app.post('/api/login',async c=>{
  const ip=clean(c.req.header('CF-Connecting-IP')||'local',64),now=Date.now();
  const attempts=await c.env.DB.prepare('SELECT count,window_start FROM login_attempts WHERE ip=?').bind(ip).first();
  if (attempts && now-attempts.window_start<900000 && attempts.count>=10) return fail(c,429,'Try again later');
  const b=await body(c);
  const email=clean(b?.email,254).toLowerCase();
  const u=isEmail(email) ? await c.env.DB.prepare('SELECT * FROM users WHERE email=?').bind(email).first():null;
  const valid=typeof b?.password==='string' && b.password.length<=128 && u && equal(await hashPassword(b.password,u.salt),u.password_hash);
  if (!valid) {
    await c.env.DB.prepare('INSERT INTO login_attempts(ip,count,window_start) VALUES (?,1,?) ON CONFLICT(ip) DO UPDATE SET count=CASE WHEN ?-window_start>900000 THEN 1 ELSE count+1 END,window_start=CASE WHEN ?-window_start>900000 THEN ? ELSE window_start END').bind(ip,now,now,now,now).run();
    return fail(c,401,'Invalid credentials');
  }
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
  const t=token();
  await c.env.DB.prepare('INSERT INTO sessions(id_hash,user_id,expires_at) VALUES (?,?,?)').bind(await digest(t),u.id,now+43200000).run();
  setCookie(c,'gic_session',t,cookieOptions(c));
  return c.json({user:publicUser(u)});
});
app.use('/api/*',auth);
app.post('/api/logout',async c=>{
  const t=getCookie(c,'gic_session');
  if(t) await c.env.DB.prepare('DELETE FROM sessions WHERE id_hash=?').bind(await digest(t)).run();
  deleteCookie(c,'gic_session',{path:'/',httpOnly:true,secure:new URL(c.req.url).protocol==='https:',sameSite:'Strict'});
  return c.json({ok:true});
});
app.get('/api/me',c=>c.json({user:publicUser(c.get('user'))}));
app.get('/api/teams',async c=>c.json({teams:(await c.env.DB.prepare('SELECT * FROM teams ORDER BY created_at DESC').all()).results}));
app.post('/api/teams',admin,async c=>{
  const b=await body(c),name=clean(b?.name,120),campus=clean(b?.campus,100),leader=clean(b?.leader,120),url=clean(b?.deck_url,1000);
  if(!name||!campus||!leader||!['Main Track','Junior Track'].includes(b?.track)||url&&!/^https:\/\//i.test(url)) return fail(c,400,'Invalid team');
  const id=random(); await c.env.DB.prepare('INSERT INTO teams (id,name,track,campus,leader,deck_url) VALUES (?,?,?,?,?,?)').bind(id,name,b.track,campus,leader,url).run();
  await log(c,'team.created',id);return c.json({id},201);
});
app.delete('/api/teams/:id',admin,async c=>{
  const id=c.req.param('id');
  const r=await c.env.DB.prepare('DELETE FROM teams WHERE id=?').bind(id).run();
  if(!r.meta.changes) return fail(c,404,'Not found');
  await log(c,'team.deleted',id);return c.json({ok:true});
});
app.get('/api/evaluations',async c=>{
  const u=c.get('user');
  const sql='SELECT e.*,t.name AS team_name,u.name AS coach_name FROM evaluations e JOIN teams t ON t.id=e.team_id JOIN users u ON u.id=e.coach_id';
  const rows=u.role==='admin' ? await c.env.DB.prepare(sql+' ORDER BY e.updated_at DESC').all() : await c.env.DB.prepare(sql+' WHERE e.coach_id=? ORDER BY e.updated_at DESC').bind(u.id).all();
  return c.json({evaluations:rows.results});
});
app.put('/api/evaluations/:teamId',async c=>{
  const b=await body(c),id=c.req.param('teamId'),user=c.get('user');
  if(!b || !Number.isInteger(b.score)||b.score<0||b.score>100||typeof b.feedback!=='string'||b.feedback.length>3000) return fail(c,400,'Invalid evaluation');
  if(!(await c.env.DB.prepare('SELECT id FROM teams WHERE id=?').bind(id).first())) return fail(c,404,'Team not found');
  await c.env.DB.prepare('INSERT INTO evaluations(id,team_id,coach_id,score,feedback) VALUES (?,?,?,?,?) ON CONFLICT(team_id,coach_id) DO UPDATE SET score=excluded.score,feedback=excluded.feedback,updated_at=CURRENT_TIMESTAMP').bind(random(),id,user.id,b.score,b.feedback.trim()).run();
  await log(c,'evaluation.saved',id);return c.json({ok:true});
});
app.get('/api/leaderboard',admin,async c=>c.json({leaderboard:(await c.env.DB.prepare('SELECT t.id,t.name,t.track,COUNT(e.id) AS evaluation_count,ROUND(AVG(e.score),1) AS average_score FROM teams t LEFT JOIN evaluations e ON e.team_id=t.id GROUP BY t.id ORDER BY average_score DESC,evaluation_count DESC').all()).results}));
app.get('/api/users',admin,async c=>c.json({users:(await c.env.DB.prepare('SELECT id,email,name,role FROM users ORDER BY created_at').all()).results}));
app.post('/api/users',admin,async c=>{
  const b=await body(c),email=clean(b?.email,254).toLowerCase(),name=clean(b?.name,100);
  if(!isEmail(email)||!name||!validPassword(b?.password)||!['coach','admin'].includes(b.role)) return fail(c,400,'Invalid account');
  const id=random(),salt=token(),hash=await hashPassword(b.password,salt);
  try{await c.env.DB.prepare('INSERT INTO users(id,email,name,role,salt,password_hash) VALUES (?,?,?,?,?,?)').bind(id,email,name,b.role,salt,hash).run();}
  catch{return fail(c,409,'Email already registered');}
  await log(c,'user.created',id);return c.json({id},201);
});
app.get('/api/audit',admin,async c=>c.json({entries:(await c.env.DB.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').all()).results}));
export default {
  fetch: app.fetch,
  async scheduled(_event,env) {
    await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(Date.now()).run();
    await env.DB.prepare('DELETE FROM login_attempts WHERE window_start<?').bind(Date.now()-900000).run();
  }
};
