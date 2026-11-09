# BusWatch

**Stop the push at the bus stop: predict when APU shuttles will overflow, and put the buses where the students are.**

> ⚠️ Every number in the prototype is **simulated**. We have no access to university data, so BusWatch generates
> 8 weeks of realistic demand for a 10,000-student campus.

### We focused on the *why*, not the *how*

Building a dashboard is the easy part. Anyone can draw charts. The hard part is understanding **why** students cut the
line, because a fix aimed at the wrong cause changes nothing. Put up more signs or more guards, and students will still
cut the line if the bus can't fit everyone.

So we spent most of our time on the problem, not the code: riding the shuttles ourselves, going through the
@apucutlineking posts, and comparing the shuttle timetable with when classes actually end. That is how we found the
real cause. Line cutting is a **symptom**. The **cause** is buses that arrive at a steady pace while students arrive in
waves. BusWatch exists to fix that cause. The prototype is the proof that it can be done, not the point of the project.

---

## 1. The problem

**What happens today.** At peak times the APU shuttle that pulls up is already too small for the crowd waiting. Students
push, cut the line, and the ones who queued properly are left behind to wait another 30 minutes. Between peaks, the same
buses run half empty.

**It is public, and it hurts APU's reputation.** Students started an Instagram page,
[@apucutlineking](https://www.instagram.com/apucutlineking/), just to post people cutting the bus queue. Anyone looking at
APU (future students, parents, partners) can see it.

**Who it hurts most.** Students who take the shuttle to **LRT Bukit Jalil** to get home, especially those who live far away.
One missed shuttle means a 30-minute wait, a missed train, and getting home late after a full day of classes.

**The root cause is planning, not just behaviour.** The shuttles run on a flat timetable (one bus every 30 minutes, all day)
but students don't arrive evenly: they arrive in waves when classes end at :50, before classes start, when it rains,
and in exam week. When more students arrive than the bus has seats, cutting the line becomes the only way to get on.

> **Problem statement:** At peak times APU's shuttle buses cannot carry everyone who is waiting, because the timetable
> does not follow when students actually travel. The result is line cutting, long waits and missed LRT connections,
> while buses run half empty at other times.

## 2. How we researched it

- **We live it.** Several of us ride the shuttles every day, to LRT Bukit Jalil and to the residences, so we started from our
  own experience of missing buses and watching the line get cut.
- **Public evidence.** We studied @apucutlineking: how often posts appear, which stops and which times. 
- **Timetable review.** We compared the APSpace shuttle timetable (Mon–Fri / Saturday / Sunday tabs, a bus every 30 minutes)
  with when classes end and start.
- **What the posts show.** The posts on @apucutlineking are filmed by students standing in the shuttle queue: other students
  walking past the line and getting on first while the bus fills up. They show this is not a one-off. It happens
  repeatedly, at the moments when more students are waiting than the bus can carry.
- **From symptoms to cause.** We listed what students complain about (cutting, waiting, full buses, empty buses) and asked
  "why" until we reached one cause we can actually fix: supply doesn't match demand at peak times.

## 3. Our solution: BusWatch

**BusWatch is built to help APU's transport operations team run the shuttles better**: put buses where the students
are, so fewer students are left behind and the line stops getting cut. Students benefit directly too, because they can
see which buses are usually full and plan around them.

It does five things:

1. **Predicts the crowd.** It turns the semester's intake and class timetable into the number of students waiting at every
   stop for every half-hour departure, using a machine-learning model.
2. **Finds the gaps.** It shows exactly which departures will have more students than seats.
3. **Tests fixes before spending money.** A simulator replays the same demand against a changed schedule.
4. **Recommends what to do.** For example: *"Run a second bus on the 17:00–19:00 LRT departures (Tue/Thu): 272 → 148 students a
   day miss a full bus, for about RM 150/day."* Each fix shows its cost.
5. **Helps students avoid the crush.** The timetable and live tracker show which buses are usually full, so students can
   take an earlier or later one.

### What each page does

| Page | For | What it does |
|---|---|---|
| Home | Everyone | The problem in one line, how BusWatch works, and the headline numbers |
| Crowd Overview | Operations team | Shows where and when it's bad: average wait, students who miss a full bus each day, and a stop × time heatmap (green = seats, amber = busy, red = overflowing) |
| Demand Forecast | Operations team | Predicts the queue at any stop and time, compared with the seats on the bus; red zones are where the line will get cut |
| Schedule Simulator | Operations team | "What if?": change a shuttle's timetable (add, move or remove buses) and see the before/after effect and its cost |
| Smart Recommendations | Operations team | Finds the worst peak times and ranks fixes by impact and cost (move a bus, change driver breaks, add buses); saves a one-page PDF report for management |
| Ask BusWatch | Operations team | Ask in plain words ("When is APU busiest?", "How much does rain matter?") and get a short answer with a chart |
| Timetable | Students | APSpace-style timetable with a dot on every departure showing whether that bus usually has seats |
| Live Bus Tracker | Students | Map of APU and Bukit Jalil with (simulated) bus positions, the next bus from each stop, and a countdown |

## 4. Impact

**For students:** fewer missed buses and missed LRT connections, shorter waits, and less reason to push.
**For APU:** fewer incidents for pages like @apucutlineking to post, better use of the buses it already pays for, and
evidence-based decisions instead of complaints.
**Beyond APU:** any campus or company shuttle with a known timetable (classes, shifts) can use the same approach.

### How we measure success

| Metric | Today (simulated) | 3 months | 6 months | 12 months |
|---|---|---|---|---|
| Students who miss a full bus / day | ≈ 530 | −30% | −50% | −60% |
| Average wait | ≈ 20 min | −15% | −25% | −30% |
| Seats used (fewer empty buses) | ≈ 46% | 50% | 55% | 60% |
| Line-cutting posts per month on @apucutlineking | ≈ 20  | −30% | −50% | −70% |
| Extra running cost | – | ≤ RM 300 / day | cost-neutral (move buses, don't add) | cost-neutral |

The targets come from the simulator: the top recommendations cut missed buses by about 15–45% on the windows they target,
and more when several are combined. These are targets to verify, not results.

### If APU implemented it now

- **Month 0–3 (pilot):** apply the top 2 recommendations (LRT evening peak, 17:00–19:00); count queues at APU and LRT
  for 2 weeks before and after; replace the simulated assumptions with the real counts.
- **Month 3–6 (scale):** all shuttles; publish crowd dots in the APSpace timetable so students spread out by themselves;
  rerun the forecast every week.
- **Month 6–12 (automate):** real bus GPS and passenger counters instead of simulation; forecast each new semester's
  timetable *before* it starts, so buses are planned around it.

## 5. How we built it

- **Time spent:** 5 days in total: 2 days of research, 2 days of building, 1 day of testing and preparing the pitch.
  Research came first and got as much time as building: we didn't write any code until we could explain *why* the line
  gets cut.
- **Steps:** research → problem statement → design the data (stops, timetable, demand rules) → build the simulation and
  forecast → build the dashboard → test → calibrate to look realistic → pitch.
- **Tech:** Python (pandas, NumPy, scikit-learn) for the data and model; plain HTML/CSS/JavaScript for the site (Plotly charts,
  Leaflet + OpenStreetMap map); Supabase (database) and Vercel (hosting).
- **No AI inside the product, on purpose.** Recommendations are rules plus simulation, so every number can be checked and
  explained to management.

## 6. How we used Claude, and the outcome

We used **Claude (Claude Code)** as an AI pair programmer:

| We did | Claude did |
|---|---|
| Found the problem, did the research, wrote the problem statement | Proposed the architecture and file structure from our brief |
| Decided the rules: APU's real stops, 30-minute timetable, 10,000 students, one shuttle per path | Wrote the data generator, queue simulation, ML model and the 8 pages |
| Reviewed every screen and asked for changes ("make it easier to read", "make it realistic") | Wrote automated tests and fixed what they caught |
| Checked the numbers made sense for APU | Explained the code and the results in plain language |

**Outcome:** a working prototype built in 2 days, so we could spend most of our 5 days on research and the problem.
We also had Claude write automatic checks that prove the prototype works:

- **The numbers don't change by accident:** running the data generator twice gives exactly the same data.
- **The simulator tells the truth:** the "what if" simulator on the website gives exactly the same results as the
  original calculation, checked on all 10,752 bus departures in the dataset.
- **The recommendations really help:** every suggested fix is re-tested and must reduce the number of students who
  miss a full bus.
- **Every page works:** each page is opened on a laptop-sized and a phone-sized screen and checked for errors.

## 7. The team

| Name | Role |
|---|---|
| Soo Jing Yuan | Problem research |
| Woo May Eng | Data and model |
| Lee Chun Kit | Web dashboard; pitch and video |
| Tan Lok Qi | QA testing |
| Liew Shen Wei | Pitch and video |

---

# How to run it

The site is plain HTML/CSS/JavaScript in the `web/` folder, and the simulated data is already included in `web/data/`.
There is nothing to build.

## Run locally

Needs Python 3 (only to serve the files).

```bash
cd web
python -m http.server 8000
```

Open http://localhost:8000. Locally the site uses the bundled data in `web/data/`.
Opening the HTML files directly (`file://`) does not work, because browsers block JavaScript modules there.
Charts and the map need internet (they load from a CDN and OpenStreetMap).

## Supabase (optional database)

The site works without Supabase. Use it if you want the data to come from a database.

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, paste [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. This creates the tables with
   Row Level Security switched on.
3. Copy `.env.example` to `.env` and fill in the three values from **Project Settings → API**.
4. Upload the data from your laptop:

   ```bash
   pip install -r requirements.txt
   python supabase/upload_data.py
   ```

The service role key is only for the upload script on your laptop. Never put it in `web/` or in Vercel.

## Deploy to Vercel

1. Push the repo to GitHub, then in Vercel click **Add New → Project** and import it.
2. Set **Root Directory** to `web` and **Framework Preset** to `Other`. Leave the build command empty.
3. If you set up Supabase, add the environment variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the public anon key, not the
   service role key). Without them the site uses the bundled data.
4. Click **Deploy**.
