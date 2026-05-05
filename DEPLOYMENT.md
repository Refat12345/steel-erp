# دليل النشر (Deployment Guide) - Steel ERP

دليل عربي كامل خطوة بخطوة لنشر نظام Steel ERP على VPS بيئة إنتاج حقيقية.
مصمّم لمهندس برمجيات ما عنده خبرة سابقة بـ DevOps، ويمشي مع **اشتراك Hostinger VPS KVM 2** و**تهيئة السيرفر لحالك** (بدون شخص شبكات منفصل).

### الوضع الحالي للسيرفر

حسب آخر تهيئة، أنت بدأت VPS من الصفر وأنجزت الأساسيات التالية:

- [x] Hostinger VPS KVM 2 جاهز.
- [x] تحديث النظام تم: `sudo apt update && sudo apt upgrade -y`.
- [x] UFW Firewall شغال، والمنافذ `22/80/443` مفتوحة.
- [x] `fail2ban` شغال.
- [x] مستخدم `deploy` موجود ومعه صلاحية `sudo`.
- [x] SSH key مضاف للمستخدم `deploy`.
- [x] Node.js 22 مثبت.
- [x] PM2 مثبت، الإصدار الحالي `7.0.1`.
- [x] PostgreSQL مثبت.

بالتالي، لا تعيد تنفيذ خطوات التثبيت المنجزة إلا إذا فشل أمر التحقق. كمل من: **Clone التطبيق، إعداد `.env.production`، إنشاء قاعدة الإنتاج ومستخدمها، migrations، ثم Nginx و HTTPS والنسخ الاحتياطية**.

---

## جدول المحتويات

1. [نظرة عامة على المعمارية](#1-نظرة-عامة-على-المعمارية)
2. [مسؤولياتك الكاملة مع Hostinger](#responsibilities-solo-hostinger)
3. [Pre-flight Checklist - قبل ما تبدأ](#3-pre-flight-checklist---قبل-ما-تبدأ)
4. [المرحلة 0: أساسيات SSH وأدوات لازم تعرفها](#4-المرحلة-0-أساسيات-ssh-وأدوات-لازم-تعرفها)
5. [المرحلة 1: شراء Hostinger وتأمين الـ VPS](#phase1-hostinger-vps)
6. [المرحلة 2: تثبيت Node.js و PM2 والتطبيق](#6-المرحلة-2-تثبيت-nodejs-و-pm2-والتطبيق)
7. [المرحلة 3: PostgreSQL + هجرة الداتا من Supabase](#7-المرحلة-3-postgresql--هجرة-الداتا-من-supabase)
8. [المرحلة 4: Nginx + HTTPS](#8-المرحلة-4-nginx--https)
9. [المرحلة 5: النسخ الاحتياطية - الأهم على الإطلاق](#9-المرحلة-5-النسخ-الاحتياطية---الأهم-على-الإطلاق)
10. [المرحلة 6: المراقبة والـ Logs](#10-المرحلة-6-المراقبة-والـ-logs)
11. [المرحلة 7: سكربت الـ Deployment للتحديثات](#11-المرحلة-7-سكربت-الـ-deployment-للتحديثات)
12. [المشاكل الشائعة وحلولها](#12-المشاكل-الشائعة-وحلولها)
13. [Maintenance - الصيانة الدورية](#13-maintenance---الصيانة-الدورية)

---

## 1. نظرة عامة على المعمارية

### ما رح نبنيه

```
المستخدمون (داخل المعمل + خارجه)
         │
         ▼
    Cloudflare (DNS + حماية DDoS + SSL طرف العميل)
         │
         ▼
    erp.company.com → IP الـ VPS
         │
         ▼
┌─────────────────────────────────────────────┐
│  Hostinger VPS (Ubuntu 24.04 LTS، ~2GB+ RAM) │
│                                             │
│  ┌──────────┐                               │
│  │  Nginx   │ ← HTTPS (Let's Encrypt)       │
│  │ :80 :443 │                               │
│  └─────┬────┘                               │
│        │ reverse proxy                      │
│  ┌─────▼───────────┐                        │
│  │   Next.js App   │ ← PM2 (auto-restart)   │
│  │   localhost:3000│                        │
│  └─────┬───────────┘                        │
│        │ Prisma                             │
│  ┌─────▼─────────────┐                      │
│  │   PostgreSQL 16   │ ← localhost only     │
│  │   steel_erp_prod  │                      │
│  └───────────────────┘                      │
│                                             │
│  Cron Job (2:00 AM يومياً):                 │
│   pg_dump → gzip → rclone → Backblaze B2    │
└─────────────────────────────────────────────┘
         │
         ▼
    Backblaze B2 (نسخ احتياطية off-site)
```

### التكلفة الشهرية المتوقعة

| البند | التكلفة |
|-------|---------|
| Hostinger VPS KVM 2 | وفق اشتراك Hostinger |
| Backblaze B2 (2-5 GB backups) | ~1$ |
| الدومين (subdomain موجود) | 0$ |
| Cloudflare (free plan) | 0$ |
| Let's Encrypt SSL | 0$ |
| UptimeRobot أو بديل مراقبة مجاني | 0$ |
| **المجموع التقريبي** | **اشتراك Hostinger + ~1$/شهر B2 (حسب الاستخدام)** |

---

<a id="responsibilities-solo-hostinger"></a>

## 2. مسؤولياتك الكاملة مع Hostinger

ما في «شخص شبكات» بالوسط: **أنت** بتشتري الـ VPS، بتأمّنه، بتضبط DNS، وبتكمل باقي الدليل (التطبيق، القاعدة، Nginx، النسخ الاحتياطي).

### مبادئ من اليوم الأول

| المبدأ | السبب |
|--------|--------|
| حساب Hostinger ببريد تسترجع منه الوصول (يفضّل تابع للشركة) | ما يضيع الاشتراك مع تغيّر الأشخاص |
| فعّل **المصادقة الثنائية** على حساب Hostinger حيث متاحة | سرقة الحساب = سيطرة على السيرفر |
| احفظ **IP العام** للـ VPS ومسار **hPanel** (Firewall، إعادة التشغيل) | استكشاف الأعطال أسرع |
| وثّق كل تغيير على السيرفر بـ `CHANGES.md` | بعد شهرين تتذكر شو عملت |

### عند الطلب من Hostinger — تم الاختيار

- [x] **VPS** وليس استضافة مشتركة: الخطة الحالية **Hostinger VPS KVM 2**.
- [x] **النظام:** Ubuntu على VPS، وتأكد من الإصدار بالأمر `cat /etc/os-release`.
- [x] **مفتاح SSH** مضاف للمستخدم `deploy`.

### DNS والشبكة (من عندك)

- [ ] **سجل A** للـ subdomain (مثلاً `erp.company.com`) يشير إلى **IP الـ VPS** (من hPanel أو البريد الترحيبي — سواء الدومين عند Hostinger أو عند مسجّل آخر).
- [ ] (موصى به) **Cloudflare** أمام الدومين: بروكسي برتقالي؛ بعد إقلاع HTTPS على السيرفر اضبط **SSL Full (strict)**.

### التطبيق والبيانات (المتبقي الآن)

- [x] فوق طبقة النظام: Node.js، PM2، PostgreSQL.
- [ ] إعدادات Nginx، ونسخة التطبيق تحت `/opt/steel-erp/app`.
- [ ] `.env.production`، كلمة مرور القاعدة، `NEXTAUTH_SECRET` إنتاج منفصل عن التطوير.
- [ ] `npx prisma migrate deploy` و أي تعديل على الـ schema.
- [ ] **نسخ احتياطي يومي واختبار استعادة** قبل ما تعتبر الإنتاج «جاهز».
- [ ] مراقبة بسيطة: `pm2`، سجلات Nginx، UptimeRobot أو بديل.

---

## 3. Pre-flight Checklist - قبل ما تبدأ

### على جهازك المحلي

- [ ] `git`, `node (v22+)`, `npm` مثبتين.
- [ ] التطبيق شغال محلياً (`npm run dev`).
- [ ] الـ `.env.local` فيه كل المتغيرات المطلوبة.
- [ ] SSH client (PowerShell 7+ على ويندوز غالباً فيه `ssh` جاهز، أو Windows Terminal، أو **طرفية Cursor** — نفس الفكرة؛ تفاصيل إضافية بـ §4).
- [ ] GitHub account والمشروع مرفوع على repo خاص.
- [ ] إنشاء SSH key لو ما عندك: `ssh-keygen -t ed25519 -C "your-email@example.com"` - المفتاح العام بيكون بـ `~/.ssh/id_ed25519.pub`.

### معلومات لازم تجمعها

- [ ] الـ subdomain اللي رح يستخدم (مثلاً `erp.company.com`).
- [ ] **IP الـ VPS** (من hPanel أو بريد الترحيب بعد الشراء).
- [ ] اسم مستخدم SSH للدخول الأول: غالباً `root` من Hostinger حتى تنشئ مستخدم `deploy`؛ بعدها استخدم `deploy` كما بالدليل.
- [ ] Backblaze B2 account (نعملها بالمرحلة 5).

---

## 4. المرحلة 0: أساسيات SSH وأدوات لازم تعرفها

### قبل الأوامر: وين تكتبها؟ (Windows + Cursor)

جهازك **Windows**. الأوامر اللي بالدليل من نوع `ssh` و `scp` هي أوامر **سطر أوامر** (Terminal). ما في فرق جوهري بين:

| المكان | ملاحظة |
|--------|--------|
| **طرفية Cursor** | من القائمة: `Terminal` → `New Terminal`، أو من لوحة المفاتيح: **Ctrl** مع المفتاح **فوق Tab** (نفس مفتاح علامة الـ grave في لوحة إنجليزية). نافذة الطرفية هي **نفس مبدأ** PowerShell أو CMD حسب الـ Default Profile. **نعم، تقدر تشتغل أوامر جهازك من هون** طالما `ssh` شغال. |
| **Windows Terminal** | تطبيق Microsoft؛ يفتح تبويب PowerShell أو Ubuntu (WSL) حسب إعدادك. |
| **PowerShell منفصل** | ابحث في قائمة ابدأ عن *Windows PowerShell* أو *PowerShell 7*. |

**متى تكون «على Windows» ومتى «على السيرفر»؟**

1. **على Windows (محلياً):** تكتب أوامر مثل `ssh deploy@...` و `scp ...` لفتح الاتصال أو نقل ملفات بين لابتوبك والـ VPS. مسار ملفاتك يكون مثل `C:\Users\اسمك\steel-erp\...`.
2. **بعد ما تدخل بـ SSH:** الطرفية تصير **جلسة Linux على الـ VPS** (Ubuntu). هون بتشتغل أوامر مثل `sudo`, `nano`, `journalctl`, `pm2`, `npx prisma migrate deploy`. هالأوامر **ما بتنفّذها على Windows مباشرة** — لازم تكون **داخل** `ssh` أولاً.

**رمز المجلد `~` (tilde):**

- على **Linux / السيرفر:** يعني «مجلد المستخدم الحالي»، غالباً `/home/deploy`.
- على **Windows مع PowerShell:** غالباً يترجم لـ `C:\Users\اسم_المستخدم` (نفس فكرة «مجلد المستخدم»).

**مفاتيح SSH — وين بتنحفظ؟**

لما تنفّذ على جهازك (من Cursor أو PowerShell):

```powershell
ssh-keygen -t ed25519 -C "your-email@example.com"
```

- الافتراضي يحفظ المفتاح تحت مجلد **مخفي** اسمه `.ssh` داخل مجلد المستخدم:
  - **Windows:** `C:\Users\اسم_المستخدم\.ssh\`
  - الملف **`id_ed25519`** = المفتاح **الخاص** — **لا** ترفعه لأي مكان ولا ترسله بالواتساب. من يمسكه يقدر يتظاهر إنك أنت أمام السيرفر.
  - الملف **`id_ed25519.pub`** = المفتاح **العام** — **هذا** اللي تنسخه إلى GitHub (**Deploy keys** أو حسابك) أو تلصقه في Hostinger (إن عندهم حقل SSH key) أو تضيفه بنفسك إلى `~/.ssh/authorized_keys` على السيرفر.
- لو سألك `ssh-keygen` عن **passphrase**: عبارة سر اختيارية لقفل المفتاح على جهازك؛ أنصح فيها على أجهزة العمل، وبعدها Windows قد يطلبها عند أول `ssh` في الجلسة.

**تأكد إن `ssh` موجود على Windows:**

```powershell
ssh -V
```

إذا ظهر خطأ «الأمر غير معروف»:

- **Windows 10/11:** الإعدادات → *Apps* → *Optional features* → تأكد من تثبيت **OpenSSH Client**؛ أو ثبّت [PowerShell 7](https://github.com/PowerShell/PowerShell/releases) من الموقع الرسمي.
- بديل شائع: تثبيت **Git for Windows** واستخدام **Git Bash** — فيه `ssh` و `scp` جاهزين.

**نسخ المفتاح العام لصقه في GitHub (مثال PowerShell):**

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard
```

(يقرأ الملف وينسخ محتواه للحافظة؛ بعدها الصق في GitHub.)

لتتأكد إن المجلد موجود من PowerShell:

```powershell
dir $env:USERPROFILE\.ssh
```

ولفتح المجلد في مستكشف الملفات:

```powershell
explorer $env:USERPROFILE\.ssh
```

---

### الأوامر اللي لازم تفهمها قبل ما تبدأ

> **تنبيه:** أوامر **`ssh`** و **`scp`** في أول الكتلة تُنفَّذ **من Windows** (طرفية Cursor أو PowerShell) — قبل الدخول أو بدون ما تفتح جلسة تفاعلية طويلة على السيرفر. **باقي الأوامر** (`sudo`, `journalctl`, `nano`, …) تُنفَّذ **بعد** ما تكون داخل جلسة **SSH على Ubuntu** (السيرفر).

```bash
# الدخول على السيرفر
ssh deploy@erp.company.com

# نسخ ملف من جهازك للسيرفر
scp ./file.txt deploy@erp.company.com:/home/deploy/

# نسخ ملف من السيرفر لجهازك
scp deploy@erp.company.com:/home/deploy/file.txt ./

# إدارة services
sudo systemctl status nginx
sudo systemctl restart postgresql
sudo systemctl stop/start <service>

# قراءة logs
journalctl -u nginx -f              # tail logs لـ service
journalctl -u nginx --since "1 hour ago"
tail -f /var/log/nginx/error.log    # tail ملف log

# مراقبة الموارد
htop                                # CPU + RAM + processes
df -h                               # مساحة القرص
free -h                             # الذاكرة
du -sh /var/log                     # حجم مجلد

# إدارة الملفات
nano /path/to/file                  # محرر سهل للمبتدئين
sudo nano /etc/nginx/sites-available/erp
cat /path/to/file                   # طباعة ملف
ls -lah /home/deploy                # عرض الملفات بالتفصيل
```

### مصادر تعلّم سريعة (ساعة-ساعتين إجمالاً)

**بالعربي:**
- يوتيوب: ابحث "أوسمة الزيرو Linux commands" - متسلسلة منظمة.
- يوتيوب: "SSH شرح بالعربي" - أي فيديو 20-30 دقيقة.

**بالإنجليزي (جودة أعلى):**
- NetworkChuck: "You NEED to learn Linux RIGHT NOW!!" (ساعة واحدة تغطي 80%).
- موقع `linuxjourney.com` - تفاعلي ومجاني.

### tmux / screen (اختياري بس مفيد)

لو عندك عملية طويلة زي `pg_restore` وخايف الـ SSH ينقطع:

```bash
sudo apt install tmux
tmux new -s migration     # ابدأ session اسمه migration
# ... شغّل العملية ...
# Ctrl+B ثم D = detach (تطلع بس العملية ضلّت شغالة)
tmux attach -t migration  # ارجع للـ session
```

---

<a id="phase1-hostinger-vps"></a>

## 5. المرحلة 1: شراء Hostinger وتأمين الـ VPS

### قبل الـ checklist: Hostinger تحديداً

- **الدخول الأول:** غالباً الـ email البيجي فيه **IP** وكلمة مرور `root` أو تعليمات SSH — جرّب `ssh root@<IP>` (أو المستخدم اللي يبان بالرسالة). بعد ما تنشئ مستخدم `deploy` بصلاحيات `sudo` ومفتاح SSH، كمّل باقي الدليل بـ `deploy@`.
- **hPanel → VPS → Firewall:** تأكد إن **22** (SSH)، **80**، **443** مسموحين. أحياناً في **جدار من اللوحة** و **UFW** على السيرفر معاً — إذا حظر أحدهما المنفذ، الاتصال أو الموقع بيوقف؛ عدّل التزامن بعناية.
- **القالب:** اختر **Ubuntu 24.04 LTS** عند إنشاء السيرفر حتى تطابق باقي الدليل.
- حدّث النظام مرة بعد أول دخول: `sudo apt update && sudo apt upgrade -y` (بعد ما تتأكد إن الجلسة ما رح تنقطع، مثلاً عبر `tmux` لو بدك حذر).

### Checklist تأمين الـ VPS (منجز عندك، فقط تحقّق)

```bash
# 1. تقدر تدخل بـ SSH (أول مرة غالباً root من Hostinger؛ بعد إنشاء deploy استخدم deploy@)
ssh deploy@<VPS_IP>
# أو بعد إعداد DNS:
ssh deploy@erp.company.com

# 2. عندك sudo
sudo whoami   # لازم يطبع: root

# 3. النظام محدّث
cat /etc/os-release  # لازم Ubuntu 24.04
uptime               # يعطيك مدة التشغيل

# 4. firewall شغال
sudo ufw status      # لازم: active, allows 22/80/443

# 5. fail2ban شغال
sudo systemctl status fail2ban

# 6. SSH آمن
sudo grep -E "^(PermitRootLogin|PasswordAuthentication)" /etc/ssh/sshd_config
# لازم:
# PermitRootLogin no
# PasswordAuthentication no

# 7. Timezone مضبوط
timedatectl
# لازم: Time zone: Asia/Damascus (أو حسب منطقتك)
```

الوضع الحالي المتوقع عندك:

- [x] `deploy` يدخل بـ SSH.
- [x] `deploy` عنده `sudo`.
- [x] النظام محدّث بـ `apt update && apt upgrade -y`.
- [x] UFW active ويسمح بالمنافذ `22`, `80`, `443`.
- [x] `fail2ban` active.
- [x] SSH key مضاف لـ `deploy`.

المهم قبل المتابعة: تأكد أيضاً من `PermitRootLogin no` و `PasswordAuthentication no` حتى لا يبقى الدخول بكلمة مرور أو root مفتوحاً.

### إذا أي واحد من الخطوات فشل

راجع الخطوة اللي فشلت، صحّح الإعداد، ولا تكمل على سيرفر غير مؤمّن.

### أضف ملف `CHANGES.md` على السيرفر

```bash
sudo mkdir -p /opt/steel-erp
sudo chown deploy:deploy /opt/steel-erp
cd /opt/steel-erp
cat > CHANGES.md << 'EOF'
# Server Changes Log

## $(date +%Y-%m-%d)
- Initial setup: Hostinger VPS, self-managed
- Ubuntu 24.04 LTS, UFW active, fail2ban running
- User 'deploy' created with sudo access
EOF
```

---

## 6. المرحلة 2: تثبيت Node.js و PM2 والتطبيق

بما أن Node.js 22 و PM2 مثبتين عندك، هذه المرحلة تبدأ بالتحقق السريع ثم Clone التطبيق.

### تحقق من Node.js 22

```bash
node --version    # لازم v22.x.x
npm --version
```

إذا ما ظهر Node.js 22، ثبّته عبر nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
nvm alias default 22
```

### تحقق من PM2

```bash
pm2 --version   # عندك حالياً 7.0.1
```

إذا الأمر غير موجود:

```bash
npm install -g pm2
pm2 --version
```

### Clone المشروع

**الطريقة الأسهل: استخدم Personal Access Token من GitHub:**

1. على GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token مع صلاحية قراءة للـ repo.
2. على السيرفر:

```bash
cd /opt/steel-erp
git clone https://<TOKEN>@github.com/<username>/steel-erp.git app
cd app
```

**الطريقة الأفضل (deploy key):**

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
# انسخ الناتج وضيفه على GitHub: Repo → Settings → Deploy keys → Add (read-only)

# أضف على ~/.ssh/config:
cat >> ~/.ssh/config << 'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

git clone git@github.com:<username>/steel-erp.git app
```

### إنشاء `.env.production`

**لا ترفع هذا الملف على Git أبداً.**

```bash
cd /opt/steel-erp/app
nano .env.production
```

المحتوى:

```ini
# Database - سيتم تعبئته في المرحلة 3 بعد تثبيت PostgreSQL
DATABASE_URL="postgresql://steel_erp:STRONG_PASSWORD@localhost:5432/steel_erp_prod?schema=public"
DIRECT_URL="postgresql://steel_erp:STRONG_PASSWORD@localhost:5432/steel_erp_prod?schema=public"

# NextAuth
NEXTAUTH_SECRET="GENERATE_NEW_SECRET_HERE"
NEXTAUTH_URL="https://erp.company.com"

# Node environment
NODE_ENV="production"
```

توليد NEXTAUTH_SECRET جديد:
```bash
openssl rand -hex 32
```

**مهم:** لا تستخدم نفس الـ `NEXTAUTH_SECRET` من `.env.local` - ولّد جديد للإنتاج.

### Build وتشغيل

```bash
# ربط .env.production بـ .env حتى Prisma و Next.js يشوفوه
ln -sf .env.production .env

npm ci
npx prisma generate
npm run build

# ملاحظة: لسه DATABASE_URL مش شغال - رح نكمل بالمرحلة 3
```

---

## 7. المرحلة 3: PostgreSQL + هجرة الداتا من Supabase

بما أن PostgreSQL مثبت عندك، ابدأ بالتحقق من الخدمة ثم أنشئ قاعدة الإنتاج ومستخدمها إذا لم تكن أنشأتها بعد.

### تحقق من PostgreSQL

```bash
sudo systemctl status postgresql
psql --version
```

إذا PostgreSQL غير مثبت أو الإصدار غير مناسب، ثبّت PostgreSQL 16:

```bash
sudo sh -c 'echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install -y postgresql-16 postgresql-client-16
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

### إنشاء Database و User

```bash
sudo -u postgres psql
```

داخل الـ psql:

```sql
-- غير الـ password لواحد قوي (ولّده بـ: openssl rand -base64 32)
CREATE USER steel_erp WITH PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';
CREATE DATABASE steel_erp_prod OWNER steel_erp;
GRANT ALL PRIVILEGES ON DATABASE steel_erp_prod TO steel_erp;

-- تحقق
\l
\q
```

### تأمين PostgreSQL (مهم جداً)

```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
```

تأكد من:
```
listen_addresses = 'localhost'   # فقط - لا تخليها '*' أبداً
port = 5432
shared_buffers = 1GB
work_mem = 32MB
max_connections = 50
```

```bash
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

تأكد إن local connections بتستخدم `scram-sha-256` (مش trust):

```
local   all             postgres                                peer
local   all             all                                     scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
host    all             all             ::1/128                 scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

### اختبار الاتصال

```bash
psql -U steel_erp -d steel_erp_prod -h localhost
# يطلب password - أدخله - لازم تدخل للـ prompt
\q
```

### هجرة الداتا من Supabase

**خطوة 1: Dump من Supabase**

على جهازك المحلي (أو على السيرفر):

```bash
# استخدم DIRECT_URL (port 5432) مش الـ pooler (port 6543) لأن pg_dump ما بيشتغل مع pooler
pg_dump "postgresql://postgres.qdhopncrgjzojyykkgpz:DbPassword123%23%24ZZY%26@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres?sslmode=require" \
  --no-owner \
  --no-acl \
  -Fc \
  -f supabase_backup.dump
```

**خطوة 2: نقل الملف للسيرفر**

```bash
scp supabase_backup.dump deploy@erp.company.com:/tmp/
```

**خطوة 3: Restore على السيرفر**

```bash
ssh deploy@erp.company.com
pg_restore -U steel_erp -d steel_erp_prod -h localhost --no-owner --no-acl /tmp/supabase_backup.dump

# لو ظهرت أخطاء warnings عن roles مش موجودة - طبيعي، تجاهلها.
# المهم: الداتا منتقلة.
```

**خطوة 4: تحقق من الداتا**

```bash
psql -U steel_erp -d steel_erp_prod -h localhost
```

```sql
-- مثال - غير الجدول حسب schema عندك
\dt
SELECT COUNT(*) FROM "User";
\q
```

**خطوة 5: تشغيل migrations (لضمان schema محدّث)**

```bash
cd /opt/steel-erp/app
npx prisma migrate deploy
```

### تشغيل التطبيق

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # انسخ الأمر اللي بيطبعه ونفّذه مع sudo

# تحقق
pm2 status
pm2 logs steel-erp --lines 50

# اختبر التطبيق
curl http://localhost:3000
```

لو شفت HTML output → التطبيق شغال داخلياً. الآن نربطه بالإنترنت.

---

## 8. المرحلة 4: Nginx + HTTPS

### تأكد من DNS

قبل ما تبدأ هالمرحلة، لازم **سجل A** للدومين يشاور على IP الـ VPS (من DNS Hostinger أو مسجّل الدومين):
```
erp.company.com → <VPS_IP>
```

اختبار من جهازك المحلي:
```bash
ping erp.company.com
# لازم يرد من IP الـ VPS
```

### تثبيت Nginx

```bash
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx
```

افتح بالمتصفح `http://<VPS_IP>` - لازم تشوف صفحة Nginx الترحيبية.

### إعداد reverse proxy

```bash
sudo nano /etc/nginx/sites-available/steel-erp
```

المحتوى:

```nginx
# Rate limiting للحماية من abuse
limit_req_zone $binary_remote_addr zone=erp_limit:10m rate=30r/s;

server {
    listen 80;
    server_name erp.company.com;

    client_max_body_size 20M;

    # Rate limit على كل requests
    limit_req zone=erp_limit burst=50 nodelay;

    # Security headers (معظمها موجود بـ next.config.ts بس نعيدها كـ defense in depth)
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1000;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
```

تفعيل الـ config:

```bash
sudo ln -s /etc/nginx/sites-available/steel-erp /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t         # اختبار syntax
sudo systemctl reload nginx
```

اختبر: افتح `http://erp.company.com` بالمتصفح - لازم تشوف التطبيق.

### تفعيل HTTPS مع Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d erp.company.com

# يسألك عن email (اكتب email الشركة) ويوافق على الشروط.
# بيعمل كل شي تلقائياً: يحصل على certificate ويعدّل nginx config.
```

**اختبار التجديد التلقائي:**
```bash
sudo certbot renew --dry-run
```

**ملاحظة إذا كنتو تستخدمون Cloudflare proxy:**
- بـ Cloudflare: SSL/TLS → Overview → **Full (strict)**.
- Let's Encrypt لسه لازم يكون شغال على origin.

افتح `https://erp.company.com` - لازم تشوف قفل أخضر والتطبيق يفتح.

### اختبار شامل

- [ ] الموقع يفتح بـ HTTPS.
- [ ] `http://` بيعمل redirect تلقائي لـ `https://`.
- [ ] Login يشتغل.
- [ ] عمليات CRUD الأساسية تشتغل.
- [ ] افتح من جهاز تاني خارج شبكة المعمل (موبايلك مع data) - لازم يفتح.

---

## 9. المرحلة 5: النسخ الاحتياطية - الأهم على الإطلاق

**لا تعتبر النظام جاهز للإنتاج قبل ما تكمل هاي المرحلة.**

### القاعدة الذهبية 3-2-1

- **3** نسخ من الداتا.
- **2** وسيط تخزين مختلف.
- **1** نسخة off-site (خارج السيرفر).

### الإعداد

#### 1. إنشاء حساب Backblaze B2

1. روح على https://www.backblaze.com/b2/sign-up.html
2. أنشئ حساب (مجاني للتسجيل، تدفع بس على الاستخدام).
3. أنشئ bucket اسمه `steel-erp-backups` (private).
4. أنشئ Application Key:
   - Name: `steel-erp-backup-key`
   - Allow access to: `steel-erp-backups` فقط (مش all buckets).
   - Type: Read and Write.
   - احفظ الـ **keyID** و **applicationKey** بمكان آمن (ما رح يظهروا تاني).

#### 2. تثبيت rclone

```bash
curl https://rclone.org/install.sh | sudo bash
```

#### 3. إعداد rclone مع Backblaze

```bash
rclone config
```

جاوب كالتالي:
```
n (new remote)
name: b2
Storage: b2 (رقم Backblaze B2 من القائمة)
account: <keyID>
key: <applicationKey>
hard_delete: false
Edit advanced config: n
Confirm: y
Quit: q
```

اختبار:
```bash
rclone ls b2:steel-erp-backups   # لازم ما يعطي خطأ (فاضي طبيعي)
```

#### 4. سكربت الـ backup

```bash
sudo mkdir -p /opt/steel-erp/scripts
sudo chown deploy:deploy /opt/steel-erp/scripts
nano /opt/steel-erp/scripts/backup.sh
```

المحتوى:

```bash
#!/bin/bash
set -euo pipefail

# Config
DB_NAME="steel_erp_prod"
DB_USER="steel_erp"
BACKUP_DIR="/tmp/steel-erp-backups"
B2_REMOTE="b2:steel-erp-backups"
RETENTION_DAYS=30
LOG_FILE="/var/log/steel-erp-backup.log"

# Setup
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db_${DATE}.dump.gz"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Backup started ==="

# 1. Dump the database (compressed)
log "Dumping database..."
PGPASSWORD="$DB_PASSWORD" pg_dump -U "$DB_USER" -h localhost -Fc "$DB_NAME" | gzip > "$BACKUP_FILE"

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "Backup created: $BACKUP_FILE ($BACKUP_SIZE)"

# 2. Upload to Backblaze
log "Uploading to Backblaze B2..."
rclone copy "$BACKUP_FILE" "$B2_REMOTE/daily/" --log-file="$LOG_FILE" --log-level INFO

# 3. Keep local copy for 3 days only
log "Cleaning local backups older than 3 days..."
find "$BACKUP_DIR" -name "db_*.dump.gz" -mtime +3 -delete

# 4. Delete remote backups older than RETENTION_DAYS
log "Cleaning remote backups older than $RETENTION_DAYS days..."
rclone delete "$B2_REMOTE/daily/" --min-age "${RETENTION_DAYS}d" --log-file="$LOG_FILE"

log "=== Backup completed successfully ==="
```

```bash
sudo chmod +x /opt/steel-erp/scripts/backup.sh
sudo touch /var/log/steel-erp-backup.log
sudo chown deploy:deploy /var/log/steel-erp-backup.log
```

#### 5. حفظ password بأمان (مش بالسكربت)

```bash
nano /opt/steel-erp/scripts/.backup-env
```

المحتوى:
```
export DB_PASSWORD='YOUR_POSTGRES_PASSWORD'
```

```bash
chmod 600 /opt/steel-erp/scripts/.backup-env
```

عدّل السكربت ليستورد هالـ env:

```bash
sed -i '2i source /opt/steel-erp/scripts/.backup-env' /opt/steel-erp/scripts/backup.sh
```

#### 6. اختبار يدوي

```bash
/opt/steel-erp/scripts/backup.sh
# تابع الناتج - لازم ينتهي بـ "Backup completed successfully"

# تحقق إنه وصل Backblaze
rclone ls b2:steel-erp-backups/daily/
```

#### 7. جدولة cron (يومياً الساعة 2:00 صباحاً)

```bash
crontab -e
```

أضف سطر:
```cron
0 2 * * * /opt/steel-erp/scripts/backup.sh >> /var/log/steel-erp-backup.log 2>&1
```

### اختبار الاستعادة (restore) - لا تتخطّى هاي الخطوة

**نسخة احتياطية ما جربتها = ما عندك نسخة احتياطية.**

```bash
# 1. حمّل آخر نسخة من Backblaze
mkdir -p /tmp/restore-test
LATEST=$(rclone ls b2:steel-erp-backups/daily/ | sort -k2 | tail -1 | awk '{print $2}')
rclone copy "b2:steel-erp-backups/daily/$LATEST" /tmp/restore-test/

# 2. فك الضغط
gunzip /tmp/restore-test/$LATEST

# 3. أنشئ DB تجريبية
sudo -u postgres psql -c "CREATE DATABASE steel_erp_restore_test OWNER steel_erp;"

# 4. Restore
DUMP_FILE=$(ls /tmp/restore-test/*.dump | head -1)
pg_restore -U steel_erp -d steel_erp_restore_test -h localhost --no-owner --no-acl "$DUMP_FILE"

# 5. تحقق
psql -U steel_erp -d steel_erp_restore_test -h localhost -c "\dt"
psql -U steel_erp -d steel_erp_restore_test -h localhost -c 'SELECT COUNT(*) FROM "User";'

# 6. نظّف
sudo -u postgres psql -c "DROP DATABASE steel_erp_restore_test;"
rm -rf /tmp/restore-test
```

**اعمل هاد الاختبار مرة كل شهر على الأقل.** حطّه بالتقويم.

### (اختياري) نسخة ثانية off-site

لطبقة أمان إضافية، ممكن تضيف نسخة أسبوعية على:
- Google Drive عبر rclone (remote مختلف).
- جهازك الشخصي عبر `rsync` أسبوعياً.

---

## 10. المرحلة 6: المراقبة والـ Logs

### UptimeRobot (مجاني)

1. سجّل على https://uptimerobot.com
2. Add New Monitor:
   - Type: HTTPS
   - URL: `https://erp.company.com`
   - Check every: 5 minutes
3. أضف email/SMS للتنبيهات.

### PM2 logrotate

حتى الـ logs ما تملأ القرص:

```bash
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

### Nginx log rotation

Ubuntu بيعمل logrotate تلقائي لـ Nginx، بس تأكد:
```bash
cat /etc/logrotate.d/nginx
```

### فحص سريع للنظام (اعمله أسبوعياً)

```bash
df -h                    # مساحة القرص - لازم تكون >20% فاضية
free -h                  # الذاكرة - لازم تكون >500MB فاضية
pm2 status               # التطبيق شغال
systemctl status nginx postgresql
tail -100 /var/log/steel-erp-backup.log   # آخر backups نجحت
```

---

## 11. المرحلة 7: سكربت الـ Deployment للتحديثات

### للبداية (بسيط ومضمون)

```bash
nano /opt/steel-erp/scripts/deploy.sh
```

```bash
#!/bin/bash
set -euo pipefail

APP_DIR="/opt/steel-erp/app"
LOG_FILE="/var/log/steel-erp-deploy.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "=== Deploy started ==="

cd "$APP_DIR"

# 1. Backup قبل أي تغيير
log "Running backup before deploy..."
/opt/steel-erp/scripts/backup.sh

# 2. Pull latest code
log "Pulling latest code..."
git fetch origin
git checkout main
git pull origin main

# 3. Install dependencies
log "Installing dependencies..."
npm ci

# 4. Run migrations
log "Running Prisma migrations..."
npx prisma generate
npx prisma migrate deploy

# 5. Build
log "Building..."
npm run build

# 6. Restart (zero-downtime مع PM2)
log "Restarting app..."
pm2 reload steel-erp

# 7. Health check
sleep 5
if curl -sf http://localhost:3000 > /dev/null; then
  log "=== Deploy successful ==="
else
  log "!!! Deploy FAILED - app is not responding !!!"
  exit 1
fi
```

```bash
chmod +x /opt/steel-erp/scripts/deploy.sh
sudo touch /var/log/steel-erp-deploy.log
sudo chown deploy:deploy /var/log/steel-erp-deploy.log
```

### استخدام

```bash
ssh deploy@erp.company.com
/opt/steel-erp/scripts/deploy.sh
```

### (متقدم، لاحقاً) GitHub Actions

لما تستقر، ممكن تعمل auto-deploy عند push على main. بس للبداية خلي الـ deployment يدوي حتى تتحكم بالوقت اللي بيصير فيه.

---

## 12. المشاكل الشائعة وحلولها

### التطبيق ما بيستجيب

```bash
pm2 status                      # شغال؟
pm2 logs steel-erp --lines 100  # شو آخر errors؟
curl http://localhost:3000      # يرد من داخل السيرفر؟
sudo systemctl status nginx     # Nginx شغال؟
sudo nginx -t                   # الـ config صحيح؟
```

### الـ DB ما بيتصل

```bash
sudo systemctl status postgresql
psql -U steel_erp -d steel_erp_prod -h localhost
# لو فشل: تحقق من password بـ .env.production
```

### Login بيفشل بصمت

- راجع `NEXTAUTH_URL` في `.env.production` - لازم تكون `https://erp.company.com` بالضبط.
- راجع `NEXTAUTH_SECRET` موجود ومش فاضي.
- بعد أي تغيير على `.env`: `pm2 restart steel-erp`.

### مساحة القرص ممتلئة

```bash
du -sh /var/log/* | sort -h         # أكبر logs
du -sh /home/deploy/.pm2/logs/*     # logs PM2
sudo journalctl --vacuum-size=500M  # قلّل journal
```

### Let's Encrypt certificate منتهي

```bash
sudo certbot renew
sudo systemctl reload nginx
```

### Backup فشل

```bash
tail -100 /var/log/steel-erp-backup.log
# تحقق من:
# - DB_PASSWORD صحيح في .backup-env
# - Backblaze keys لسه شغالة
# - مساحة /tmp كافية
```

### PM2 ما يشتغل بعد reboot

```bash
pm2 save
pm2 startup   # نفّذ الأمر اللي بيطبعه
```

---

## 13. Maintenance - الصيانة الدورية

### يومياً (تلقائي)

- Backup يومي الساعة 2:00 صباحاً.
- PM2 auto-restart لو التطبيق كراش.
- UptimeRobot بيراقب.

### أسبوعياً (يدوي، ~5 دقائق)

- [ ] فحص `pm2 status` و `pm2 logs --lines 50`.
- [ ] فحص `df -h` و `free -h`.
- [ ] تأكد من آخر backup: `tail -20 /var/log/steel-erp-backup.log`.

### شهرياً

- [ ] **اختبار استعادة من backup** (الخطوة بالمرحلة 5).
- [ ] `sudo apt update && sudo apt upgrade -y` (بعد backup).
- [ ] مراجعة users ونشاطهم على النظام.
- [ ] مراجعة حجم الـ DB: `sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('steel_erp_prod'));"`.

### كل 3 شهور

- [ ] تجديد passwords (DB, NEXTAUTH_SECRET يحتاج strategy حذرة).
- [ ] مراجعة `/etc/ssh/sshd_config` و firewall rules.
- [ ] `sudo apt autoremove` لتنظيف packages قديمة.

### كل سنة

- [ ] مراجعة خطة الـ VPS (هل لازم ترقية؟).
- [ ] مراجعة تكلفة Backblaze (حجم النسخ بيزيد مع الوقت).

---

## ملاحظات ختامية

- **القاعدة الذهبية:** أي تغيير على الـ production → اعمل backup قبله.
- **لما تحتار:** ارجع لهاد الملف. محدّث بالممارسات اللي اشتغلت معك.
- **لو شي انكسر ومش عارف تصلحه:** PM2 و Nginx عندهم logs دائماً. ابدأ منهم.
- **للتطوير المستمر:** جهازك المحلي = Supabase أو DB محلي + `npm run dev`. الـ VPS = للإنتاج فقط.

أي تغيير على السيرفر → وثّقه بـ `CHANGES.md`. مستقبلك رح يشكرك.
