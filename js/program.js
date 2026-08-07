// ===================================================================
//  MAIN APP
// ===================================================================
// ===================================================================
//  PROGRAM ENGINE  — age-appropriate, rest-first, per-sport
//  Every recommendation is general guidance, not medical/nutrition
//  advice. Bands cap intensity by age; strength stays bodyweight-first.
// ===================================================================
function ageBand(age){
  if(age==null) return 'preteen';
  if(age<=6) return 'littles';
  if(age<=9) return 'youth';
  if(age<=12) return 'preteen';
  if(age<=15) return 'teen';
  return 'older';
}

// ---- sport-specific skill work (falls back to GENERIC_SKILL) ----
const GENERIC_SKILL={
  young:[{title:'Fundamentals & fun', dur:'10 min', why:'At this age, broad movement and play beat early specialization.', how:['10 min of your sport\'s main skill, played as a game','Mix in running, jumping, throwing, balancing','Keep it light and playful'], say:'"Let\'s play — try it a few different ways."', mistake:'Over-coaching or drilling too hard, too young.', stop:'When focus fades — short and sweet wins.'}],
  mid:[{title:'Core skill focus', dur:'15 min', why:'Pick one core skill from practice and get lots of quality reps.', how:['Choose one skill (a shot, pass, stroke, or move)','15 min of focused, correct reps','Finish on a success'], say:'"One thing, done well, beats ten done sloppy."', mistake:'Random practice with no clear focus.', stop:'If technique slips when tired — rest and reset.'}],
  old:[{title:'Skill work + quick film', dur:'20 min', why:'Deliberate practice plus fast self-review accelerates skill.', how:['Warm up','20 min focused work on one weakness','Film a rep, watch it, adjust one thing'], say:'"Small tweaks, repeated, become big gains."', mistake:'Grinding volume with no feedback.', stop:'Sharp pain or heavy fatigue → stop.'}],
};
const SKILLS={
  cheer:{
    young:[{title:'Motions & mini-jumps', dur:'8–10 min', why:'Sharp arm motions and simple jumps are the base of every cheer — and they\'re fun.', how:['Practice High-V, T, and Touchdown — sharp and still','5 tuck jumps onto grass or a mat','Hold a tall, strong cheer stance'], say:'"Freeze it! Sharp arms, big smile."', mistake:'Loose, bent, floppy arms.', stop:'No tumbling or stunting at home — that\'s for the gym with a coach and mats.'}],
    mid:[{title:'Jump technique', dur:'12–15 min', why:'Higher toe-touches and pikes come from core strength and clean form, not just effort.', how:['5 tuck jumps — knees up, land soft and quiet','Seated toe-touch stretch for hip flexibility','3× jump straight into a motion sequence'], say:'"Lift from your core, point your toes, land like a feather."', mistake:'Leading with the head or crashing the landing.', stop:'Tumbling and stunting only at the gym with a coach and proper mats — never on hard ground.'},
      {title:'Motion sharpness & voice', dur:'8–10 min', why:'Clean, synced motions and a loud, clear voice are exactly what judges score.', how:['Run the full motion sequence in a mirror, freezing each hit','Add the chant with a strong, projected voice','Film one attempt and watch it back together'], say:'"Hit it and hold it — sharp and loud."', mistake:'Rushing or mumbling the words.', stop:'Rest the voice if it turns hoarse; sip water.'}],
    old:[{title:'Conditioning for stunts & tumbling', dur:'15–20 min', why:'Strong core, shoulders, and wrists keep flyers and bases safe as skills get harder.', how:['Hollow-body holds — 3×20s','Wall handstand holds — 3×15–20s','Wrist, shoulder, and ankle prep'], say:'"Strong body first, then safe skills."', mistake:'Trying new stunts or passes without a spotter.', stop:'Advanced tumbling and stunting belong in the gym with coaches and mats — full stop.'}],
  },
  gymnastics:{mid:[{title:'Shapes & flexibility', dur:'15 min', why:'Tight body shapes and flexibility are the foundation of every gymnastics skill.', how:['Hollow and arch holds — 3×15s each','Bridge hold and a gentle backbend','Splits progressions, both sides — ease in'], say:'"Squeeze everything tight — like a superhero."', mistake:'Forcing flexibility or bouncing into stretches.', stop:'Bars, beam, and vault skills belong in the gym with coaches and mats — not at home.'}]},
  dance:{mid:[{title:'Technique & across-the-floor', dur:'15 min', why:'Clean technique and flexibility make every routine look effortless.', how:['Warm up: pliés, tendus, gentle stretches','Practice one combo slowly, then up to tempo','Balance holds — relevé 10s each side'], say:'"Control it — dance is strength you can\'t see."', mistake:'Skipping the warm-up before big movements.', stop:'Sharp joint pain (ankles/knees) → stop and rest.'}]},
  football:{
    young:[{title:'Catch & carry', dur:'10 min', why:'Confident hands and ball security start young and stick for life.', how:['15 soft catches from a parent toss — look it in','Tuck the ball high and tight, jog 5 yards','Switch hands and repeat'], say:'"Watch it all the way into your hands."', mistake:'Looking away before the catch.', stop:'Keep it light — no contact drills at home.'}],
    mid:[{title:'Reliable hands', dur:'15 min', why:'Great hands come from reps and keeping eyes on the ball.', how:['20 catches from a toss — eyes to the tuck','10 catches over each shoulder','5 catches on the move'], say:'"Soft hands, eyes in — every single one."', mistake:'Catching against the body or peeking upfield early.', stop:'Ease off if fingers get jammed.'},
      {title:'Footwork & agility', dur:'10 min', why:'Quick, coordinated feet help every position.', how:['Use a ladder, chalk, or cones','In-in-out-out patterns, both lead feet','5 reps with a full walk-back'], say:'"Light and quick — eyes up, not down."', mistake:'Staring at the feet the whole time.', stop:'Full rest between reps; quality over speed.'}],
  },
  soccer:{
    young:[{title:'Dribbling fun', dur:'10 min', why:'Lots of touches early builds comfort and control.', how:['Dribble through 4–6 cones, both feet','Freeze on "stop", go on "go"','Little toe-taps on top of the ball'], say:'"Small touches — keep the ball close, like it\'s on a string."', mistake:'Big kicks that lose the ball.', stop:'When focus fades — keep it playful.'}],
    mid:[{title:'First touch & passing', dur:'15 min', why:'A clean first touch and accurate pass are the heart of the game.', how:['Pass against a wall — 20 each foot, cushion the return','Dribble a cone slalom, both feet','5 first-touch-then-pass reps'], say:'"Cushion it, then look up."', mistake:'Only using the strong foot.', stop:'Rest if touches get sloppy.'}],
  },
  basketball:{
    young:[{title:'Dribble & control', dur:'10 min', why:'Ball handling is comfort with the ball — best built through play.', how:['Dribble right hand 30s, left hand 30s','Walk while dribbling to a target','Bounce-catch rhythm game'], say:'"Fingertips, not palms — eyes up."', mistake:'Slapping with the palm and staring down.', stop:'Keep it fun and short.'}],
    mid:[{title:'Form shooting & layups', dur:'15 min', why:'Groove clean shooting form up close before shooting far.', how:['Form shots 3 ft from the rim — 20, perfect arc','10 layups each side','Crossovers between cones'], say:'"B.E.E.F. — balance, eyes, elbow, follow-through."', mistake:'Heaving from too far with broken form.', stop:'Stop if the shot gets flat or forced.'}],
  },
  volleyball:{
    young:[{title:'Bumps & control', dur:'10 min', why:'A steady platform is the first volleyball skill.', how:['Bump a soft ball up to yourself — 10 in a row','Pass back and forth with a parent','Freeze in ready position'], say:'"Flat platform, use your legs."', mistake:'Swinging the arms instead of using the legs.', stop:'Use a soft/beach ball to protect young forearms.'}],
    mid:[{title:'Passing & setting', dur:'15 min', why:'Consistent passing and hand-setting run the whole offense.', how:['Forearm passes to a target — 20 steady reps','Overhead sets against a wall — soft hands','Serve-receive footwork'], say:'"Beat the ball to the spot, then pass."', mistake:'Reaching instead of moving the feet.', stop:'Rest wrists/forearms if sore.'}],
  },
  baseball:{mid:[{title:'Throwing & fielding', dur:'15 min', why:'Accurate throws and soft hands are the base of infield/outfield play.', how:['Warm up the arm gradually','20 accurate throws to a target','Field 15 grounders — glove out front, soft hands'], say:'"Line up, step, and throw to the chest."', mistake:'Rushing the throw before securing the catch.', stop:'Respect arm fatigue — no over-throwing.'}]},
  softball:{mid:[{title:'Fielding & hitting', dur:'15 min', why:'Clean fielding and a balanced swing build all-around players.', how:['Field 15 grounders — soft hands, glove out front','Tee work — 20 balanced swings, level path','Accurate throws to a target'], say:'"Watch it into the glove, then throw."', mistake:'Standing up too early on grounders.', stop:'Stop if the swing or arm gets tired and sloppy.'}]},
  track:{mid:[{title:'Sprint form & drills', dur:'15 min', why:'Good mechanics make every athlete faster and safer.', how:['A-skips and high-knees — 2× each','4 × 20-yard build-ups (accelerate, then relax)','Full walk-back recovery'], say:'"Tall posture, quick feet, relaxed face."', mistake:'Sprinting hard with no warm-up.', stop:'Full recovery between runs; stop if hamstrings tighten.'}]},
};
// ---- position-specific skill work (keyed by sport → position code → band bucket) ----
// When an athlete has positions selected, the weekly plan pulls drills for THOSE
// positions first (e.g. a QB/RB gets a QB drill and an RB drill), then falls back
// to the sport's general skills, then to GENERIC_SKILL. Football is built out first.
const POSITION_SKILLS={
  football:{
    QB:{
      young:[
        {title:'Little QB: grip & toss', dur:'8–10 min', why:'A comfy grip and a soft, on-target toss are all a young quarterback needs first — it builds confidence and hand-eye control.', how:['Show the grip: fingers across the laces, ball not jammed into the palm','10 short tosses to a parent 5–8 feet away — step and follow through','Play "hit the target" at a taped X on the wall or a bucket'], say:'"Step to your target and reach for it — like a high-five."', mistake:'Throwing all arm with no step, or squeezing the ball too tight.', stop:'Keep throws short and light — no long heaves for little arms.'},
        {title:'Handoff & fake', dur:'6–8 min', why:'Clean handoffs and a simple fake teach ball control and footwork every young QB uses.', how:['Practice a soft, two-handed handoff to a parent or sibling walking past','Add a little fake, then hand it the other way','Keep the ball tucked and secure the whole time'], say:'"Hide it, hand it, high and tight."', mistake:'Slapping the ball at the runner instead of placing it in the belly.', stop:'Just play — no live contact.'},
      ],
      mid:[
        {title:'Throwing mechanics', dur:'15 min', why:'A repeatable motion — feet, hips, follow-through — turns a toss into an accurate spiral.', how:['Warm up the arm with short, easy throws','20 throws to a partner or net: point the lead foot, rotate the hips, follow through across the body','5 throws on the move: roll one way, set the feet, deliver'], say:'"Feet first, then let the arm follow."', mistake:'All-arm throws with no lower-body drive.', stop:'Stop if the shoulder aches — arm care matters young.'},
        {title:'Footwork & drops', dur:'10 min', why:'Quick, balanced feet on a 3-step drop give a QB time and a strong base to throw from.', how:['Practice a clean 3-step drop and set','Ball held high and ready, eyes up','5 reps, walk back and reset each time'], say:'"Fast feet back, eyes downfield, ready to fire."', mistake:'Staring at the feet or drifting backward off balance.', stop:'Quality reps over speed — rest between.'},
      ],
      old:[
        {title:'Drop-back & timing + film', dur:'20 min', why:'Timing between footwork and the route is what separates good high-school QBs — and film makes it click fast.', how:['Warm up the arm progressively','Work 3- and 5-step drops with on-time throws to spots','Film 3–4 reps, watch, fix one thing: base, eyes, or follow-through'], say:'"On time and on balance beats a big arm."', mistake:'Late, off-platform throws; skipping the warm-up.', stop:'Respect arm fatigue — build volume gradually, no max-effort throwing when tired.'},
      ],
    },
    RB:{
      young:[
        {title:'Ball security: high & tight', dur:'8–10 min', why:'Protecting the ball is the first job of a running back — and a habit best built early.', how:['Tuck the ball high and tight against the ribs, elbow down','Jog through 4 cones keeping it covered','A parent gives gentle taps to knock it loose — squeeze and protect'], say:'"High and tight — never let go of the rock."', mistake:'Carrying the ball loose or away from the body.', stop:'Playful taps only — no real contact or tackling at home.'},
        {title:'Start & go', dur:'6–8 min', why:'Quick first steps and reacting to a signal build the burst a running back lives on.', how:['Line up, react to "GO!" and sprint 5–10 yards to a cone','Take a soft handoff first, then go','3–4 reps with full rest and lots of cheering'], say:'"Explode on go — the first three steps are everything."', mistake:'Leaning or false-stepping before the go.', stop:'Full rest between sprints — keep it fun, not exhausting.'},
      ],
      mid:[
        {title:'Vision & cuts', dur:'15 min', why:'Seeing the gap and cutting decisively is what turns a good back into a dangerous one.', how:['Set cones as defenders; practice a plant-and-cut and a jump cut, both directions','Keep the ball high and tight through every cut','5 reps each way, walk-back rest'], say:'"Press it, plant, and go — decide and commit."', mistake:'Dancing and hesitating instead of one hard cut.', stop:'Non-contact only; rest between reps.'},
        {title:'Footwork & agility', dur:'10 min', why:'Quick, coordinated feet help a back stick cuts and stay balanced.', how:['Ladder or chalk: in-in-out-out, both lead feet','Weave through cones keeping the ball secure','5 reps, full walk-back'], say:'"Light and quick — eyes up, ball tight."', mistake:'Watching the feet; loose ball on cuts.', stop:'Quality over speed; full rest.'},
      ],
      old:[
        {title:'Contact balance & pad level', dur:'20 min', why:'Running behind your pads with balance protects the ball and breaks tackles — trained safely without live contact.', how:['Low, athletic stance; drive through a hand shield or bag a parent holds','3-cone bursts finishing low and balanced','Ball-security reps through simulated contact (bag taps)'], say:'"Low man wins — stay low, stay square, ball high and tight."', mistake:'Running tall or exposing the ball.', stop:'No live tackling at home; save real contact for supervised practice.'},
      ],
    },
    WR:{
      young:[
        {title:'Soft hands', dur:'8–10 min', why:'Catching with the hands (not the body) and watching it in is the whole game for a young receiver.', how:['15 soft catches from a parent toss — reach and look it in','Make a diamond with the hands for high balls','Tuck it away after every catch'], say:'"Eyes all the way in, then tuck it."', mistake:'Catching against the chest or looking upfield early.', stop:'Light tosses; keep it fun.'},
      ],
      mid:[
        {title:'Routes & releases', dur:'15 min', why:'Sharp cuts and a clean release get a receiver open — footwork wins routes.', how:['Run simple routes (slant, out, hitch), planting hard at the top','Catch 15 on-the-move balls, eyes to the tuck','Add a quick release step off the line'], say:'"Sell it, snap the cut, look it in."', mistake:'Rounding cuts or drifting.', stop:'Rest if legs or hands get tired and sloppy.'},
      ],
    },
  },
};

function skillsFor(sportKey, band, positions){
  const bucket=(band==='littles'||band==='youth')?'young':(band==='preteen')?'mid':'old';
  // 1) position-specific drills for the athlete's chosen positions
  const posMap=POSITION_SKILLS[sportKey];
  let out=[];
  if(posMap && Array.isArray(positions)){
    positions.forEach(code=>{
      const p=posMap[code]; if(!p) return;
      const list=p[bucket]||p.mid||p.young||p.old;
      if(list && list.length) out.push(list[0]); // one signature drill per position
    });
  }
  // 2) top up from the sport's general skills (and generic) so there are ≥2 sessions
  const general=(SKILLS[sportKey] && (SKILLS[sportKey][bucket]||SKILLS[sportKey].mid||SKILLS[sportKey].young||SKILLS[sportKey].old))
    || GENERIC_SKILL[bucket] || GENERIC_SKILL.mid;
  general.forEach(g=>{ if(out.length<2 && !out.some(x=>x.title===g.title)) out.push(g); });
  // if a single position was chosen, add its second drill for variety
  if(posMap && Array.isArray(positions) && positions.length===1){
    const p=posMap[positions[0]]; const list=p&&(p[bucket]||p.mid||p.young||p.old);
    if(list && list[1] && !out.some(x=>x.title===list[1].title)) out.splice(1,0,list[1]);
  }
  return out.length?out:general;
}

// ---- age-safe strength (bodyweight-first) ----
const STRENGTH={
  littles:[{title:'Animal movements', dur:'5–8 min', why:'Builds coordination and core strength through play — no "exercise" needed yet.', how:['Bear crawl across the room and back','Crab walk to a target','5 frog jumps, then wiggle it out'], say:'"Can you move like a bear? Now a crab!"', mistake:'Turning it into drills or counting reps.', stop:'When it stops being fun — that\'s the whole session at this age.'}],
  youth:[{title:'Bodyweight basics', dur:'8–10 min', why:'Teaches clean movement with just their body — the foundation for everything later.', how:['5 squats, sitting back to a chair','5 wall push-ups','10-second front plank','8 small hops, soft knees'], say:'"Slow and strong beats fast and sloppy."', mistake:'Adding weight or chasing numbers.', stop:'If form gets messy or focus fades — quality over quantity.'}],
  preteen:[{title:'Bodyweight strength circuit', dur:'12–15 min', why:'Bodyweight strength builds control and injury resistance — the right kind of strong for this age.', how:['2 rounds, rest between:','8 squats (chest tall)','6 push-ups (knees or toes)','20-second plank','8 glute bridges','5 reverse lunges each leg'], say:'"Own each rep. Rest between rounds."', mistake:'Rushing reps or holding the breath.', stop:'No heavy weights yet — bodyweight and control first.'}],
  teen:[{title:'Full-body strength', dur:'20–25 min', why:'Technique-focused strength (bodyweight + light resistance) supports growth spurts and power. Form first, always.', how:['2–3 rounds:','Goblet squat, light — 8','Push-ups — 8–10','Band or dumbbell row — 10','Hip hinge (RDL), light — 8','Plank — 30s'], say:'"Perfect reps only. We never max out at your age."', mistake:'Ego lifting, skipping the warm-up, or copying adult programs.', stop:'Sharp joint pain or form breakdown → end the set. Have a coach check lifting form.'}],
  older:[{title:'Structured strength', dur:'30–40 min', why:'Progressive full-body strength builds real power and durability — with form as the non-negotiable.', how:['Warm up 5 min','Squat pattern — 3×6–8','Push (bench/push-up) — 3×8','Pull (row/pull-up) — 3×8','Hinge (RDL) — 3×6','Core finisher — 2 sets'], say:'"Add weight only when every rep looks clean."', mistake:'Progressing load faster than technique.', stop:'Sharp pain, dizziness, or form failure. Use a qualified coach for barbell work.'}],
};

// ---- speed / agility / cardio ----
const SPEED={
  littles:[{title:'Chase & tag games', dur:'5–10 min', why:'Sprinting is natural at this age — games build speed without "training".', how:['Tag, red-light green-light, or races to a cone','Change directions, giggle, repeat'], say:'"Fast feet! Can you beat me to the tree?"', mistake:'Structured sprint drills — too early.', stop:'When they\'re winded or bored — done.'}],
  youth:[{title:'Run, skip, gallop', dur:'8–10 min', why:'Teaches the body to move fast and coordinated before adding intensity.', how:['4 × 15-yard easy runs, full walk-back rest','High skips for height','Gallop and side-shuffle to a cone'], say:'"Tall and light, like you\'re barely touching the ground."', mistake:'No rest between runs.', stop:'If they\'re gasping — rest is part of speed work.'}],
  preteen:[{title:'Acceleration & agility', dur:'10–15 min', why:'Short accelerations and cone work build the quickness every sport uses.', how:['5 × 10–15 yard accelerations, full recovery (walk back)','Weave through 4 cones, both directions','Jump rope — 3 × 30 seconds'], say:'"Explode the first 3 steps, then relax."', mistake:'Long sprints with little rest — this is quality, not conditioning.', stop:'Keep rest full (30–60s). Fatigue = sloppy = risk.'}],
  teen:[{title:'Speed mechanics & change-of-direction', dur:'15–20 min', why:'Sprint form and cutting work now translate directly to the field or court.', how:['Warm up thoroughly (5 min)','A-skips / wall drives — 3×','4–6 × 20-yard sprints, full recovery','5-10-5 shuttle — 4 reps, rest 60s'], say:'"Sharp cuts, low hips, drive out."', mistake:'Skipping the warm-up or under-resting.', stop:'Full recovery between reps; stop if hamstrings feel tight.'}],
  older:[{title:'Sprint & conditioning', dur:'20–30 min', why:'Higher-intensity speed and conditioning, dosed with real recovery.', how:['Dynamic warm-up','Sprint or plyo block (measured, quality reps)','Sport-specific conditioning intervals','Cool down'], say:'"Quality first. Log it so we can see progress."', mistake:'Junk volume that just builds fatigue.', stop:'Respect rest; stop plyos if landings get sloppy.'}],
};

// ---- fuel, hydration, sleep, recovery (general habits) ----
function fuelCards(band){
  const sleep=(band==='teen'||band==='older')?'8–10 hours':'9–12 hours';
  return [
    {title:'Hydration', why:'Even mild dehydration drops focus and performance.', how:['A water bottle to every practice','Sip before, during, and after activity','Watch for dark urine, headaches, or cramps'], say:'"Water first — sports drinks only for long, sweaty sessions."', mistake:'Waiting until they\'re thirsty to drink.', stop:'Dizziness or cramping = stop and hydrate.'},
    {title:'Balanced plate', why:'Growing athletes need fuel to grow AND perform — food is a good thing.', how:['½ plate fruits & veg','¼ lean protein (chicken, eggs, beans, fish)','¼ whole grains','A snack with carbs + protein after activity (e.g., yogurt & fruit)'], say:'"Eat enough to grow — we don\'t diet or count calories at your age."', mistake:'Restricting food or skipping meals before sport.', stop:'Any worry about eating, weight, or under-fueling → talk to your pediatrician or a registered dietitian.'},
    {title:'Sleep ('+sleep+')', why:'Sleep is when kids grow and skills stick — it\'s the #1 recovery tool.', how:['Consistent bedtime, even on weekends','Screens off 30–60 min before bed','Extra sleep the night before games'], say:'"Sleep is training too."', mistake:'Late screens and irregular bedtimes.', stop:'Ongoing exhaustion → ease the schedule.'},
    {title:'Recovery & rest days', why:'Two-plus true rest days a week lower injury and burnout — progress happens on recovery.', how:['Light stretch or an easy walk on rest days','Gently relax sore muscles','Keep at least 1–2 full days off sport each week'], say:'"Rest is part of the plan, not a break from it."', mistake:'Training through pain or never taking days off.', stop:'Pain lasting >2 weeks, limping, or swelling → see a doctor.'},
  ];
}
const GAMEDAY={title:'Game day', dur:'', why:'Game day is for competing and having fun — not cramming new skills.', how:['Light breakfast + hydrate well','Arrive calm; warm up with the team','After: name one thing that went well and one to work on — then let it go'], say:'"I love watching you play." (skip the play-by-play critique)', mistake:'Coaching from the sideline or post-game film sessions.', stop:'Any head-injury signs (headache, dizziness, confusion, nausea) → out of play and see a medical pro.'};
const RECOVERY={title:'Active recovery', dur:'', why:'Easy movement on off days helps muscles rebuild and keeps kids fresh.', how:['10–15 min easy walk, bike, or swim','Gentle full-body stretch','Hydrate and get to bed on time'], say:'"Today we recharge — that\'s how we get stronger."', mistake:'Turning rest days into extra training.', stop:'Real soreness or fatigue → take true rest.'};

function buildProgram(age, goals, sportKey, positions){
  const band=ageBand(age);
  const skills=skillsFor(sportKey, band, positions);
  const strength=STRENGTH[band];
  const speed=SPEED[band];
  const fuel=fuelCards(band);
  const speedy=goals.some(g=>['speed','agility','endurance'].includes(g.key));
  const skillA=skills[0], skillB=skills[1]||skills[0];
  let days;
  if(band==='littles'){
    days=[
      {d:'Mon',t:'train',type:'play',title:skillA.title,sub:skillA.dur+' · fun first',act:skillA},
      {d:'Tue',t:'rest',type:'rest',title:'Free play & rest',sub:'Unstructured play',act:RECOVERY},
      {d:'Wed',t:'train',type:'play',title:skillB.title,sub:skillB.dur,act:skillB},
      {d:'Thu',t:'rest',type:'rest',title:'Rest',sub:'Recovery & sleep',act:RECOVERY},
      {d:'Fri',t:'gym',type:'move',title:strength[0].title,sub:strength[0].dur+' · movement play',act:strength[0]},
      {d:'Sat',t:'game',type:'game',title:'Game or class',sub:'Have fun',act:GAMEDAY},
      {d:'Sun',t:'rest',type:'rest',title:'Full rest',sub:'Family day',act:RECOVERY},
    ];
  } else {
    days=[
      {d:'Mon',t:'train',type:'skill',title:skillA.title,sub:skillA.dur,act:skillA},
      {d:'Tue',t:'gym',type:'strength',title:strength[0].title,sub:strength[0].dur,act:strength[0]},
      {d:'Wed',t:'rest',type:'rest',title:'Active recovery',sub:'Light + stretch',act:RECOVERY},
      {d:'Thu',t:'train',type:(speedy?'speed':'skill'),title:(speedy?speed[0].title:skillB.title),sub:(speedy?speed[0].dur:skillB.dur),act:(speedy?speed[0]:skillB)},
      {d:'Fri',t:'rest',type:'rest',title:'Light + mental',sub:'Visualize & relax',act:RECOVERY},
      {d:'Sat',t:'game',type:'game',title:'Game day',sub:'Compete & have fun',act:GAMEDAY},
      {d:'Sun',t:'rest',type:'rest',title:'Full rest',sub:'Recovery builds athletes',act:RECOVERY},
    ];
  }
  return {band, days, skills, strength, speed, fuel};
}

const BAND_LINE={littles:'short, playful sessions with lots of rest',youth:'fundamentals and fun — quality over quantity',preteen:'skill focus with age-safe strength and speed',teen:'structured training with form first',older:'progressive training, still form-first'};

function openActivity(act){
  if(!act) return;
  sheet(H`
    <h3>${esc(act.title)}</h3>
    ${act.dur?`<span class="pill" style="margin:6px 0 2px">${esc(act.dur)}</span>`:''}
    <p style="font-size:13.5px;line-height:1.5;margin:12px 0 0"><b>Why it matters.</b> ${esc(act.why)}</p>
    ${act.how&&act.how.length?`<div class="sec-title" style="margin:16px 2px 8px">How to do it</div><ol style="margin:0;padding-left:20px;font-size:13.5px;line-height:1.7">${act.how.map(s=>`<li>${esc(s)}</li>`).join('')}</ol>`:''}
    ${act.say?`<div class="teach" style="margin-top:14px"><div class="ic">🗣️</div><div><h4>What to say</h4><p>${esc(act.say)}</p></div></div>`:''}
    ${act.mistake?`<p style="font-size:13px;color:var(--muted);margin-top:12px"><b style="color:var(--ink)">Common mistake:</b> ${esc(act.mistake)}</p>`:''}
    ${act.stop?`<div style="background:#FBE9DC;border:1px solid #E6C9BC;border-radius:12px;padding:11px 13px;margin-top:12px;font-size:12.5px;color:#8a3b12;line-height:1.5"><b>Safety — when to stop:</b> ${esc(act.stop)}</div>`:''}
  `);
}

