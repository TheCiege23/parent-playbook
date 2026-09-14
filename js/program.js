// ===================================================================
//  MAIN APP
// ===================================================================
// ===================================================================
//  PROGRAM ENGINE  — age-appropriate, rest-first, per-sport
//  Every recommendation is general guidance, not medical/nutrition
//  advice. Bands cap intensity by age; strength stays bodyweight-first.
// ===================================================================
function ageBand(age){
  // Unknown age → the most conservative band, not the middle one. Handing a 6-year-old
  // the preteen circuit (push-ups, planks, lunges) because a birthdate went missing is a
  // real risk; handing an older kid the playful band is merely too easy.
  if(age==null) return 'littles';
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
  tennis:{
    young:[{title:'Rally & control', dur:'8–10 min', why:'Lots of easy contact builds feel and confidence.', how:['Bounce-and-hit with a parent or wall, soft and controlled','Split-step and move to the ball','Contact out front, both sides'], say:'"Watch it, meet it out front, smooth swing."', mistake:'Swinging too hard.', stop:'Keep rallies playful; hydrate.'}],
    mid:[{title:'Groundstrokes & movement', dur:'15 min', why:'Consistency and footwork win youth tennis.', how:['20 forehands and 20 backhands to targets, low-to-high','Split-step and recover to the middle','Serve toss and a smooth motion'], say:'"Prepare early, low to high, recover."', mistake:'Standing still and reaching.', stop:'Rest the shoulder on serves; warm up first.'}],
    old:[{title:'Serve +1 & point play', dur:'20 min', why:'Linking a serve to the next ball and building points is how matches are won.', how:['Warm up thoroughly','Serve to targets, then play the first ball with intent','Patterns: serve wide, then hit the open court','Live points to a set score'], say:'"Serve with a plan, then take the first ball."', mistake:'No plan after the serve.', stop:'Warm up the shoulder; stop on any joint pain.'}],
  },
  swimming:{
    young:[{title:'Body position & kick (with a lifeguard)', dur:'8–10 min', why:'A long, flat body and a steady kick are the base of every stroke.', how:['Streamline push-offs, arms by the ears','Flutter kick with a board, small fast kicks','Rhythmic breathing and bubbles'], say:'"Long and flat, small fast kicks, blow bubbles."', mistake:'Kicking from the knees or lifting the head.', stop:'Always with a lifeguard; never swim alone or hold your breath for games.'}],
    mid:[{title:'Stroke technique (with a lifeguard)', dur:'15 min', why:'Clean technique and relaxed breathing make swimming efficient.', how:['Stroke drills (catch-up freestyle, 6-kick switch)','Bilateral or rhythmic breathing','Easy laps on one cue'], say:'"Long strokes, steady breathing, relax."', mistake:'Short, choppy strokes.', stop:'Always supervised; get out if cold or tired.'}],
    old:[{title:'Sets, pacing & turns (with a lifeguard)', dur:'20–30 min', why:'Structured sets, pacing, and clean turns build a real swimmer — with recovery.', how:['Warm up','Technique and aerobic sets on an interval','Flip turns and streamline off every wall','Cool down'], say:'"Hold your technique when it gets tired — that is the work."', mistake:'Junk yardage with sloppy form.', stop:'Always with a lifeguard; respect fatigue and never do breath-holding sets.'}],
  },
  wrestling:{
    young:[{title:'Stance & motion', dur:'8–10 min', why:'A good stance and moving well are the safe base of wrestling.', how:['Athletic stance: knees bent, hands ready, head up','Move: forward, back, circle','Level changes, back straight'], say:'"Low stance, head up, quick feet."', mistake:'Bending at the waist.', stop:'No live wrestling or takedowns at home.'}],
    mid:[{title:'Shots, sprawls & conditioning', dur:'15 min', why:'Shot footwork and a strong base translate to the mat — trained solo, safely.', how:['Penetration step to a pad (no partner)','Sprawl and recover to the stance','Bodyweight conditioning: bear crawls, squats, planks'], say:'"Change levels, drive on balance, back to your stance."', mistake:'Dropping the head or lunging.', stop:'Live wrestling only at practice with a coach and mats.'}],
    old:[{title:'Drilling & conditioning', dur:'20–25 min', why:'Repeating positions and hard conditioning build a varsity wrestler — live goes at practice.', how:['Solo drill shots, level changes, and stance-to-base','Hard bodyweight and core conditioning circuit','Hip and shoulder mobility'], say:'"Perfect reps solo, then live it up at practice."', mistake:'Trying live moves on hard ground at home.', stop:'No slamming or live wrestling at home — coach, partner, and mats only.'}],
  },
};
// ---- position-specific skill work (keyed by sport → position code → band bucket) ----
// When an athlete has positions selected, the weekly plan pulls drills for THOSE
// positions first (e.g. a QB/RB gets a QB drill and an RB drill), then falls back
// to the sport's general skills, then to GENERIC_SKILL.
// Shared sets first, for positions that train alike:
const _FB_DB={ // football defensive backs (CB, S)
  young:[
    {title:'Backpedal & break', dur:'8–10 min', why:'A smooth backpedal and a quick break on the ball are the base of every defensive back.', how:['Backpedal 5 yards staying low, then break forward on a clap','Catch a soft toss at the break','5 reps each way, full walk-back'], say:'"Stay low, eyes up, break on the ball."', mistake:'Standing tall or crossing the feet.', stop:'Non-contact and fun.'},
    {title:'Mirror & react', dur:'6–8 min', why:'Staying in front of a moving target builds the footwork every DB needs.', how:['Face a parent and shuffle to mirror them left and right','React to a point and sprint 5 yards','Rest and repeat'], say:'"Feet ready, mirror me, then go."', mistake:'Lunging instead of shuffling.', stop:'Full rest between reps.'},
  ],
  mid:[
    {title:'Coverage footwork', dur:'15 min', why:'Clean backpedal, hip-turn, and break let a DB stay on top of routes.', how:['Backpedal, open the hips, and run — both directions','Break on a thrown ball and high-point the catch','5–6 reps with full recovery'], say:'"On top, in phase, play the ball."', mistake:'Opening the hips late or grabbing.', stop:'Non-contact; rest between reps.'},
    {title:'Ball skills', dur:'10 min', why:'Interceptions come from tracking and catching — DBs are athletes who can catch.', how:['High-point 15 thrown balls at the top of a break','Track over-the-shoulder catches, both shoulders','Tuck every one away'], say:'"Find it, high-point it, tuck it."', mistake:'Batting the ball down instead of catching.', stop:'Rest if focus fades.'},
  ],
  old:[
    {title:'Press, zone & film', dur:'20 min', why:'Advanced DBs win with press technique, zone eyes, and studying tendencies on film.', how:['Press footwork: patient hands, mirror the release','Zone drops with eyes on the QB, break on the throw','Film a route concept and call the coverage'], say:'"Patient hands, eyes on your key, drive on the throw."', mistake:'Grabbing early or peeking without leverage.', stop:'Non-contact; care for hamstrings with a full warm-up.'},
  ],
};
const _BB_IF={ // baseball infield (1B, 2B, 3B, SS, UTIL)
  young:[
    {title:'Soft-hands grounders', dur:'8–10 min', why:'Fielding a ground ball with soft hands out front is the first infield skill.', how:['Roll 15 grounders; field with the glove out front, funnel to the belly','Athletic stance, butt down','Say "ball" and watch it into the glove'], say:'"Glove out front, watch it in, soft hands."', mistake:'Reaching back or standing straight up.', stop:'Use a soft ball for young infielders.'},
    {title:'Field & flip', dur:'6–8 min', why:'Fielding then making a quick, accurate flip builds infield rhythm.', how:['Field a grounder and flip to a parent at a base','Step toward the target','5 reps, alternate directions'], say:'"Field, step, throw to the chest."', mistake:'Throwing before securing the ball.', stop:'Easy throws — protect young arms.'},
  ],
  mid:[
    {title:'Field, footwork & throw', dur:'15 min', why:'Getting into a good throwing position quickly turns fielding into outs.', how:['Field 15 grounders, working through the ball with the feet','Set the feet and throw accurately to a target','Add a few backhands and short-hops'], say:'"Round it off, work through it, throw on line."', mistake:'Fielding flat-footed and throwing off balance.', stop:'Warm up first; respect arm fatigue.'},
    {title:'Double-play footwork', dur:'10 min', why:'Quick, clean feet at the bag turn two — footwork before speed.', how:['Practice the pivot and feed at a base','Catch, tag the bag, and clear','Slow and correct, then a bit quicker'], say:'"Catch it clean, then quick feet."', mistake:'Rushing the feed and dropping the exchange.', stop:'Non-contact; no sliding into anyone.'},
  ],
  old:[
    {title:'Range, exchanges & double plays', dur:'20 min', why:'Varsity infield is about range, clean exchanges, and turning two under pressure.', how:['Field to both sides with crossover reads','Fast, clean glove-to-hand exchanges','Turn the double play from both bags with quick feet'], say:'"Get to it early, clean exchange, quick and accurate."', mistake:'Slow exchange or throwing off balance.', stop:'Warm up the arm fully; respect volume.'},
  ],
};
const _BK_BIG={ // basketball bigs (PF, C)
  young:[
    {title:'Layups & rebounds', dur:'8–10 min', why:'Finishing at the rim and grabbing the ball are what young bigs do best.', how:['10 layups each side, soft off the glass','Toss the ball off the backboard and rebound it strong','Chin the ball after every grab'], say:'"Two hands, chin it, finish high."', mistake:'Bringing the ball down low after a rebound.', stop:'Keep it fun; no contact under the rim.'},
    {title:'Box out & post-up', dur:'6–8 min', why:'Getting position early is a big-man superpower — and it starts with feet, not muscle.', how:['Practice a box-out turn and hold position','Post up, receive a pass, pivot','Finish with a layup'], say:'"Find your man, turn, and hold your spot."', mistake:'Pushing with the arms instead of using the body.', stop:'Non-contact reps at home.'},
  ],
  mid:[
    {title:'Post footwork & finishing', dur:'15 min', why:'Drop steps and up-and-unders let a big score without jumping over anyone.', how:['Drop step to the middle and the baseline','Up-and-under counter','10 finishes each move, both hands'], say:'"Read the defender, counter, finish soft."', mistake:'Rushing into a jump hook with no footwork.', stop:'Rest if the shot gets forced.'},
    {title:'Rebounding & outlet', dur:'10 min', why:'Securing the board and starting the break makes a big valuable at both ends.', how:['Rebound off the backboard, land balanced, chin it','Pivot and make a strong outlet pass','8–10 reps'], say:'"Grab it high, chin it, outlet quick."', mistake:'Bringing the ball down where guards can strip it.', stop:'Controlled effort; rest as needed.'},
  ],
  old:[
    {title:'Post moves, face-up & pick-and-roll', dur:'20 min', why:'A complete big scores with the back to the basket, faces up, and finishes the roll.', how:['Counter series: drop step, up-and-under, jump hook both hands','Face-up jab and one-dribble finish','Roll to the rim and finish off two feet'], say:'"Read the defender, counter, finish strong."', mistake:'Predictable moves with no counter.', stop:'Warm up the knees; stop if a finish gets reckless.'},
  ],
};
const _SOC_ATT={ // soccer attackers (FW, WING)
  young:[
    {title:'Dribble & finish', dur:'8–10 min', why:'Dribbling with control and shooting on goal are the fun heart of attacking play.', how:['Dribble through 4 cones with close touches','Finish into a small goal or target','Both feet, 8–10 reps'], say:'"Small touches, then pick your spot."', mistake:'Big kicks that lose the ball.', stop:'Keep it playful.'},
    {title:'First touch to shot', dur:'6–8 min', why:'A good first touch sets up a quick shot before defenders recover.', how:['Receive a pass, take one settling touch, then shoot','Both feet','5–6 reps'], say:'"Touch, look, finish."', mistake:'Taking too many touches before shooting.', stop:'Rest if touches get sloppy.'},
  ],
  mid:[
    {title:'Finishing & 1v1', dur:'15 min', why:'Beating a defender and finishing calmly is what separates attackers.', how:['1v1 moves (cut, step-over) past a cone or parent','Finish low and placed, both feet','Near-post and far-post finishes'], say:'"Commit the defender, then finish calm."', mistake:'Blasting every shot instead of placing it.', stop:'Warm up first; rest between reps.'},
    {title:'Crossing & runs', dur:'10 min', why:'Timing runs and serving good balls create goals for wingers and forwards.', how:['Dribble the wing and cross to a target zone','Near-post and cut-back crosses','Time a run to finish a served ball'], say:'"Head up, pick the pass, time your run."', mistake:'Crossing with the head down.', stop:'Hydrate and rest as needed.'},
  ],
  old:[
    {title:'Finishing under pressure & movement', dur:'20 min', why:'Advanced attackers create separation, finish first-time, and read the last defender.', how:['First-time finishes from crosses and cut-backs','Check-away and spin to create space','Read offside and time runs in behind'], say:'"Move to create space, finish first-time, stay onside."', mistake:'Static movement and heavy touches near goal.', stop:'Full warm-up; rest between reps.'},
  ],
};
const _CHEER_STUNT={ // cheer bases & backspots (BASE, BACK)
  young:[
    {title:'Strong body & motions', dur:'8–10 min', why:'Bases and backspots build the strength and sharp motions every stunt is built on — safely, on the ground.', how:['Sharp High-V, T, and Touchdown motions, held still','Wall sits and plank holds for a strong base','Squat-and-stand with tall posture'], say:'"Strong legs, sharp arms, steady base."', mistake:'Trying to lift or stunt at home.', stop:'No stunting at home — stunts belong at the gym with a coach and mats.'},
    {title:'Grips & counts (no lift)', dur:'6–8 min', why:'Clean hand grips and timing on the ground prepare a base with no risk.', how:['Practice hand positions and timing counts on the ground','Load-in footwork with no flyer','Call the counts out loud together'], say:'"Feet set, grips ready, hit on the count."', mistake:'Practicing lifts without a coach or spotter.', stop:'Absolutely no stunting or tossing at home.'},
  ],
  mid:[
    {title:'Stunt conditioning', dur:'15 min', why:'A strong core, shoulders, and legs keep bases and backspots safe as stunts get harder.', how:['Hollow-body holds 3×20s','Wall handstand holds 3×15–20s','Squats and calf raises for the legs'], say:'"Strong body first, then safe skills at the gym."', mistake:'Attempting new stunts outside of practice.', stop:'Stunting only at the gym with coaches and mats — never at home.'},
    {title:'Motions, voice & timing', dur:'10 min', why:'Synced, sharp motions and loud counts are what make a stunt group work.', how:['Run motion sequences in a mirror, freezing each hit','Call counts loudly and in sync','Film one and review'], say:'"Hit it, hold it, call it loud."', mistake:'Soft motions or off-count timing.', stop:'Rest the voice if hoarse; hydrate.'},
  ],
  old:[
    {title:'Advanced stunt conditioning', dur:'20 min', why:'Varsity bases and backspots need serious core, shoulder, and leg strength plus dialed timing — the strength work is done at home, the stunts at the gym.', how:['Core circuit: hollow rocks, planks, hip thrusts','Overhead and shoulder stability holds','Footwork and count timing on the ground with the group'], say:'"Own the strength here, own the stunt at the gym."', mistake:'Practicing tosses or new stunts anywhere but coached practice.', stop:'All stunting and tumbling only at the gym with coaches and mats — never at home.'},
  ],
};
const _VB_HIT={ // volleyball hitters (OH, OPP)
  young:[
    {title:'Approach & swing', dur:'8–10 min', why:'A rhythmic 3-step approach and full arm swing are the base of every hitter.', how:['Practice the approach steps, arms swinging back and up','Swing at a ball held high or a gentle self-toss','Land on two feet, balanced'], say:'"Approach, jump, swing tall — reach for the sky."', mistake:'One-foot landings or a short-arm swing.', stop:'Use a soft/beach ball; jump onto a soft surface.'},
    {title:'Hands & control', dur:'6–8 min', why:'Ball control makes a hitter versatile.', how:['Forearm bumps to yourself, 10 in a row','Toss-and-catch in ready position','Simple pass to a parent'], say:'"Flat platform, use your legs."', mistake:'Swinging the arms instead of the legs.', stop:'Soft ball to protect young forearms.'},
  ],
  mid:[
    {title:'Attack approach & arm swing', dur:'15 min', why:'Timing the approach and a fast arm swing turn a hit into a kill.', how:['Approach and swing at a tossed ball to a target zone','Practice hitting line and cross-court','Cover after every swing'], say:'"High point, snap the wrist, aim for the floor."', mistake:'Approaching too early or a slow arm swing.', stop:'Jump onto a good surface; rest the shoulder.'},
    {title:'Serving & serve-receive', dur:'10 min', why:'Consistent serving and clean passing win youth volleyball.', how:['10 serves to zones (underhand or float by age)','Forearm passes from a toss to a target','Move the feet to the ball'], say:'"Toss steady, contact firm, aim your serve."', mistake:'Reaching instead of moving the feet.', stop:'Rest wrists and forearms if sore.'},
  ],
  old:[
    {title:'Shot selection, tooling & serving', dur:'20 min', why:'Elite hitters vary shots, tool the block, and serve aggressively with control.', how:['Hit line, cross, and high-hands off the block','Roll shots and tips to open zones','Jump or float serve to targets under control'], say:'"See the block, pick your shot, finish smart."', mistake:'Swinging the same shot every time.', stop:'Land soft; protect the shoulder and knees.'},
  ],
};
const _VB_BACK={ // volleyball back row (L, DS)
  young:[
    {title:'Passing & ready position', dur:'8–10 min', why:'Back-row players live in a low, ready stance and pass the ball steady.', how:['Hold a low ready stance, weight forward','Forearm pass a soft toss to a target, 10 reps','Shuffle to the ball, do not reach'], say:'"Low and ready, beat the ball to the spot."', mistake:'Standing tall or swinging the arms.', stop:'Soft ball for young forearms.'},
  ],
  mid:[
    {title:'Passing & digging', dur:'15 min', why:'A libero or defensive specialist controls the back row with platform passing and quick digs.', how:['Platform passes to a target from tosses and hits','Practice a dig and a sprawl on a soft floor','Read the hitter and move early'], say:'"Angle your platform, quiet arms, move your feet."', mistake:'Late feet and swinging at the ball.', stop:'Dig on a soft surface; rest as needed.'},
  ],
  old:[
    {title:'Serve-receive systems & digging', dur:'20 min', why:'A varsity libero anchors serve-receive and reads hitters to dig hard-driven balls.', how:['Serve-receive passing to a setter target from tough serves','Read the hitter and dig line and cross','Pursuit and up-ball to a target under control'], say:'"Read early, platform to target, pursue everything."', mistake:'Guessing instead of reading the hitter.', stop:'Dig on a good surface; rest as needed.'},
  ],
};
const _TR_ENDUR={ // track middle/distance (MID, DIST)
  young:[
    {title:'Easy runs & games', dur:'8–10 min', why:'Young distance runners build a love of running through easy, fun movement.', how:['Easy jog with a parent, chatting the whole time','Mix in skipping and a few playful pickups','Keep it comfortable and fun'], say:'"Easy and breezy — we can talk the whole way."', mistake:'Running too hard, too young.', stop:'Stop if it stops being fun; hydrate.'},
  ],
  mid:[
    {title:'Pacing & aerobic base', dur:'15 min', why:'Learning to run relaxed at an easy pace builds the engine for middle and distance events.', how:['Easy continuous run at a talking pace','Add 3–4 relaxed 20-second pickups','Cool down with an easy jog and stretch'], say:'"Relaxed and steady beats fast and gassed."', mistake:'Turning every run into a race.', stop:'Respect fatigue; build mileage gradually.'},
  ],
  old:[
    {title:'Structured runs & pacing', dur:'25–30 min', why:'Middle and distance runners build fitness with easy volume plus controlled quality — dosed with recovery.', how:['Easy run at conversational pace','A controlled tempo or cruise-interval segment','Strides and a cool-down; log the effort'], say:'"Easy days easy, hard days controlled — never all-out."', mistake:'Running every day hard.', stop:'Build mileage about 10% at a time; back off on pain or heavy fatigue.'},
  ],
};
const _GYM_BASE={ // gymnastics — safe at-home shapes/flexibility/conditioning (all events)
  young:[
    {title:'Shapes & flexibility', dur:'8–10 min', why:'Tight shapes and flexibility are the foundation of every gymnastics skill — built safely on the floor.', how:['Hollow and arch holds, 3×15s','Bridge and a gentle backbend','Straddle and pike stretches'], say:'"Squeeze tight, point your toes, hold it still."', mistake:'Forcing flexibility or bouncing.', stop:'Beam, bars, and vault skills belong at the gym with coaches and mats — not at home.'},
    {title:'Handstand & balance', dur:'6–8 min', why:'Handstand shape and balance carry into everything.', how:['Wall handstand holds, 3×10–15s','Tall relevé balance, 10s each foot','Straight jump to a soft landing'], say:'"Tall, tight, and squeezed — like a pencil."', mistake:'Arched (banana) handstand.', stop:'Handstands against a wall or on soft ground only.'},
  ],
  mid:[
    {title:'Strength & flexibility', dur:'15 min', why:'Core, shoulder, and leg strength plus flexibility keep gymnasts safe as skills advance.', how:['Hollow-body and arch holds, 3×20s','Wall handstand holds, 3×15–20s','Splits progressions and bridge, both sides'], say:'"Strong and flexible first, then skills at the gym."', mistake:'Training new skills at home without mats or a coach.', stop:'All apparatus and tumbling skills belong at the gym with coaches and mats.'},
  ],
  old:[
    {title:'Advanced conditioning & flexibility', dur:'20 min', why:'Elite gymnasts need serious strength and flexibility — safely trainable at home, while skills stay at the gym.', how:['Hollow and arch leg lifts and rocks, 3 sets','Press-shape and handstand strength against a wall','Oversplit progressions and shoulder flexibility, controlled'], say:'"Strength and flexibility here; skills on the equipment at the gym."', mistake:'Attempting beam, bar, or vault skills at home.', stop:'All apparatus and tumbling belong at the gym with coaches and mats.'},
  ],
};
const _DANCE_TECH={ // dance technique base (BALLET-adjacent styles)
  young:[
    {title:'Positions & motions', dur:'8–10 min', why:'Clean positions and staying on the beat are the base of every dance style.', how:['Practice foot and arm positions','Simple steps on the count','Hold each pose still and tall'], say:'"Tall posture, sharp on the beat."', mistake:'Rushing the counts.', stop:'Keep it fun.'},
  ],
  mid:[
    {title:'Technique & combos', dur:'15 min', why:'Clean technique and control make any routine look effortless.', how:['Warm up, then a combo slowly, then up to tempo','Balance holds, relevé 10s each side','Practice one turn or leap with good form'], say:'"Control it — dance is strength you cannot see."', mistake:'Skipping the warm-up before big movements.', stop:'Sharp joint pain (ankles or knees), stop and rest.'},
  ],
  old:[
    {title:'Technique, turns & performance', dur:'20 min', why:'Advanced dancers refine clean lines, multiple turns, and performance quality.', how:['Full warm-up and center work','Turn progressions (doubles) and controlled leaps','Run a combo full-out for performance quality, then film and refine'], say:'"Clean lines, strong core, dance it full-out."', mistake:'Marking instead of committing to performance quality.', stop:'Warm up fully; sharp ankle or knee pain, stop.'},
  ],
};
const _TEN={ // tennis base (singles-adjacent)
  young:[
    {title:'Ready, rally & control', dur:'8–10 min', why:'Young players build feel with lots of easy contact and movement.', how:['Bounce-and-hit against a wall or with a parent, soft and controlled','Ready position, split-step, move to the ball','Forehand and backhand contact out front'], say:'"Watch the ball, meet it out front, smooth swing."', mistake:'Swinging too hard and missing.', stop:'Keep rallies playful; hydrate.'},
  ],
  mid:[
    {title:'Groundstrokes & movement', dur:'15 min', why:'Consistent forehands and backhands plus good footwork win youth tennis.', how:['20 forehands and 20 backhands to targets, low-to-high swing','Split-step and recover to the middle after each shot','Practice a smooth serve toss and motion'], say:'"Prepare early, low to high, recover to the middle."', mistake:'Standing still and reaching.', stop:'Rest the shoulder on serves; warm up first.'},
  ],
  old:[
    {title:'Point patterns & serve +1', dur:'20 min', why:'Advanced singles is built on serve +1, consistent depth, and smart patterns.', how:['Warm up thoroughly','Serve to targets, then attack the first ball','Rally with depth and change direction with purpose','Play live points with a pattern in mind'], say:'"Heavy, deep, and patient — then attack the short ball."', mistake:'Going for too much with no pattern.', stop:'Warm up the shoulder; stop on joint pain.'},
  ],
};
const _SWIM_BASE={ // swimming — always supervised; stroke technique base (all strokes)
  young:[
    {title:'Body position & kick', dur:'8–10 min (with a lifeguard)', why:'A long, flat body and a steady kick are the base of every stroke.', how:['Streamline push-offs, arms squeezed by the ears','Flutter kick with a board, small fast kicks','Blow bubbles and practice rhythmic breathing'], say:'"Long and flat, small fast kicks, blow your bubbles."', mistake:'Kicking from the knees or lifting the head.', stop:'Always with a lifeguard or adult; never swim alone and never hold your breath for games.'},
  ],
  mid:[
    {title:'Stroke technique & breathing', dur:'15 min (with a lifeguard)', why:'Clean technique and relaxed breathing make swimming efficient and fun.', how:['Drills for your stroke (catch-up freestyle, 6-kick switch, and similar)','Bilateral or rhythmic breathing','Easy laps focusing on one cue'], say:'"Long strokes, steady breathing, relax."', mistake:'Rushing with short, choppy strokes.', stop:'Always supervised by a lifeguard; get out if cold or tired — no breath-holding games.'},
  ],
  old:[
    {title:'Sets, pacing & turns (with a lifeguard)', dur:'20–30 min', why:'Advanced swimmers hold technique through structured sets, pace, and race turns — always supervised.', how:['Warm up','Technique and aerobic sets on an interval','Flip turns, streamline, and underwater kick off every wall','Cool down'], say:'"Hold your stroke when it gets hard — that is racing."', mistake:'Junk yardage with breaking form.', stop:'Always with a lifeguard; respect fatigue and never breath-hold.'},
  ],
};
const _WR={ // wrestling — stance/motion/conditioning; no live contact at home (all styles)
  young:[
    {title:'Stance & motion', dur:'8–10 min', why:'A good stance and moving well are the safe foundation of wrestling — no live contact needed.', how:['Athletic stance: knees bent, hands ready, head up','Move in the stance: forward, back, circle','Level changes: bend the knees, keep the back straight'], say:'"Low stance, head up, quick feet."', mistake:'Standing tall or bending at the waist.', stop:'No live wrestling or takedowns at home — stance and motion only.'},
  ],
  mid:[
    {title:'Level change, penetration & conditioning', dur:'15 min', why:'Shot footwork and a strong base translate to the mat — trained safely without a partner.', how:['Level change and penetration step to a pad (no partner)','Sprawl and return to the stance','Bodyweight conditioning: bear crawls, squats, planks'], say:'"Change levels, drive on balance, back to your stance."', mistake:'Dropping the head or lunging off balance.', stop:'Live wrestling belongs at practice with a coach and mats — never wrestle on hard ground.'},
  ],
  old:[
    {title:'Solo drilling & hard conditioning', dur:'20–25 min', why:'Varsity wrestlers groove positions solo and build a big engine — live goes at practice.', how:['Drill shots, level changes, and stance-to-base solo','Hard bodyweight and core conditioning circuit','Gentle, controlled neck, hip, and shoulder mobility'], say:'"Perfect solo reps, then wrestle live at practice."', mistake:'Live moves or slamming on hard ground at home.', stop:'No live wrestling at home — coach, partner, and mats only.'},
  ],
};
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
      old:[
        {title:'Route tree, releases & contested catches', dur:'20 min', why:'Varsity receivers beat press, run a full route tree at speed, and win contested balls.', how:['Release moves vs a press look (footwork, no contact)','Run the route tree at game speed, snapping every break','High-point 15 contested/back-shoulder catches'], say:'"Beat press, snap your routes, high-point it."', mistake:'Rounding breaks or losing focus on contested balls.', stop:'Warm up hamstrings; rest between sprints.'},
      ],
    },
    TE:{
      young:[
        {title:'Catch & tuck', dur:'8–10 min', why:'A tight end is a big receiver first — reliable hands and a quick tuck.', how:['15 soft catches, look it in','Catch and tuck, then jog 5 yards','A few catches over each shoulder'], say:'"Look it in, tuck it away."', mistake:'Body catches or early turns upfield.', stop:'Light and fun; no contact.'},
        {title:'Block stance & steps (no contact)', dur:'6–8 min', why:'Good stance and first steps are the safe foundation of blocking.', how:['Athletic stance, hands ready','Short choppy first steps to a hand shield a parent holds lightly','Stay square and balanced'], say:'"Low, square, hands inside."', mistake:'Standing tall or lunging.', stop:'No live contact — footwork and shields only.'},
      ],
      mid:[
        {title:'Routes & sealing', dur:'15 min', why:'Tight ends win with sharp short routes and by sealing defenders.', how:['Run stick, out, and seam routes, planting hard','Catch 15 on-the-move balls','Practice a seal turn against a bag'], say:'"Sharp cut, catch, and seal your man."', mistake:'Rounding routes.', stop:'Non-contact; rest between reps.'},
      ],
      old:[
        {title:'Route running & run blocking (bags)', dur:'20 min', why:'A varsity TE is a receiving threat and a blocker — routes at speed plus clean blocking technique on bags.', how:['Seam, flat, and stick routes at game speed vs a jam release','Hand placement and drive footwork into a bag/shield','Contested and back-shoulder catches'], say:'"Win the route, then finish the block."', mistake:'Soft releases or rising up in the block.', stop:'Bags and shields only — no live contact.'},
      ],
    },
    K:{
      young:[
        {title:'Kick off a tee', dur:'8–10 min', why:'A clean strike off a tee builds the contact and confidence a young kicker needs.', how:['Line up 2–3 steps back and to the side','Strike through the bottom third with the instep','10 kicks at a target, reset each time'], say:'"Plant, strike through it, follow through to the target."', mistake:'Toe-poking or looking up early.', stop:'Keep the volume low for young legs.'},
      ],
      mid:[
        {title:'Plant & follow-through', dur:'15 min', why:'A consistent plant foot and follow-through make field goals repeatable.', how:['Measure steps (back and over)','Plant beside the ball, strike, follow through to the target','10–15 kicks, track your makes'], say:'"Same steps, same strike, every time."', mistake:'Inconsistent plant or decelerating through the ball.', stop:'Rest the leg; stop if the hip or knee aches.'},
      ],
      old:[
        {title:'Field goals, kickoffs & operation', dur:'20 min', why:'A varsity kicker owns distance, kickoffs, and a fast, repeatable operation.', how:['Field goals from several distances, tracking makes','Kickoff approach with controlled power','Quick get-off timing (snap-hold-kick rhythm)'], say:'"Same operation, trust your leg, finish through it."', mistake:'Over-swinging for distance and losing the plant.', stop:'Manage leg volume; stop on hip or knee pain.'},
      ],
    },
    ATH:{
      young:[
        {title:'All-around athlete', dur:'10 min', why:'Young all-purpose players win by being great movers — run, catch, and change direction.', how:['Catch 10 tosses, then sprint to a cone','Weave through cones with the ball high and tight','A few quick change-of-direction races'], say:'"Do a little of everything — have fun moving fast."', mistake:'Over-specializing too young.', stop:'Keep it playful; full rest.'},
      ],
      mid:[
        {title:'Multi-skill circuit', dur:'15 min', why:'Versatile players train catching, ball security, and agility together.', how:['3 stations: catching, ball-security cone runs, agility ladder','2 rounds, walk-back rest','Finish with a fun 1-on-1 move'], say:'"Sharp at everything — that is your edge."', mistake:'Skipping ball security when catching.', stop:'Non-contact; rest between rounds.'},
      ],
      old:[
        {title:'Multi-position skills & film', dur:'20 min', why:'A varsity athlete/utility player sharpens several position skills and studies film to play anywhere.', how:['Rotate: routes & catching, ball security, and DB backpedal-break','Film a rep from each and fix one thing','Agility + conditioning finisher'], say:'"Master a few positions — versatility gets you on the field."', mistake:'Being average at everything instead of sharp.', stop:'Non-contact; rest between rounds.'},
      ],
    },
    CB:_FB_DB,
    S:_FB_DB,
    LB:{
      young:[
        {title:'Shuffle & react', dur:'8–10 min', why:'Linebackers read and move — shuffling and reacting is the safe base to train young.', how:['Shuffle side to side staying low','React to a point and sprint 5 yards','Practice a soft form-wrap on a bag or pillow, no contact'], say:'"Stay low, read, and go — wrap up soft."', mistake:'Crossing the feet or ducking the head.', stop:'No tackling at home — form and footwork only.'},
      ],
      mid:[
        {title:'Read, fill & pursuit', dur:'15 min', why:'Taking good angles and filling gaps is the thinking part of linebacker play.', how:['Shuffle, read a key, and fill a gap (cones)','Practice pursuit angles to a moving parent','Form-tackle a bag at walking speed, head up and to the side'], say:'"Eyes on your key, right angle, head up."', mistake:'Over-running the play or dropping the head.', stop:'No live contact; heads-up form only — save tackling for coached practice.'},
      ],
      old:[
        {title:'Run fits, pass drops & angles (form only)', dur:'20 min', why:'A varsity linebacker diagnoses run fits, drops into coverage, and takes perfect angles — trained without live contact.', how:['Run-fit reads and gap fills off a key (cones)','Zone/hook drops with eyes on the QB','Pursuit angles and heads-up form-tackle a bag at controlled speed'], say:'"Diagnose, fit your gap, right angle, head up."', mistake:'False steps or dropping the head into contact.', stop:'No live contact; heads-up form only — tackling belongs at coached practice.'},
      ],
    },
    DL:{
      young:[
        {title:'Get-off & hands', dur:'8–10 min', why:'The first step and good hands are what young defensive linemen win with.', how:['Explode off the line on "GO" for 5 yards','Two-hand punch on a bag a parent holds lightly','Reset and repeat'], say:'"First step wins — hands ready, explode."', mistake:'Standing up out of the stance.', stop:'Bag work only — no live contact.'},
      ],
      mid:[
        {title:'Stance, first-step & shed', dur:'15 min', why:'A powerful stance, quick first step, and hand use let a lineman shed blocks.', how:['3-point stance, explode on the snap','Punch and shed a bag','Practice a swim or rip move on a stand-up bag'], say:'"Low, fast, hands inside, then shed and go."', mistake:'Rising up and losing leverage.', stop:'Bags and shields only; no live contact at home.'},
      ],
      old:[
        {title:'Pass rush & run technique (bags)', dur:'20 min', why:'A varsity D-lineman wins with get-off, a pass-rush plan, and run-game leverage — all on bags.', how:['Get-off and hand combat on a bag','Rush moves: swim, rip, and bull on a stand-up bag','Run-game leverage: low pad level, shed, and pursue'], say:'"First step and hands — then win with a plan."', mistake:'Rising up or rushing with no counter.', stop:'Bags and shields only — no live contact at home.'},
      ],
    },
    OL:{
      young:[
        {title:'Stance & steps (no contact)', dur:'8–10 min', why:'Balance and footwork come first for young linemen — before any contact.', how:['Balanced stance, weight on the balls of the feet','Short kick-slide and drive steps','Hands inside, eyes up'], say:'"Low base, quick feet, hands inside."', mistake:'Leaning or crossing the feet.', stop:'Footwork only — no contact.'},
      ],
      mid:[
        {title:'Pass-set & drive footwork', dur:'15 min', why:'Clean pass sets and drive steps are the foundation of blocking.', how:['Kick-slide pass sets, staying square','Drive-block footwork into a bag','Punch timing on a held shield'], say:'"Set square, punch on time, move your feet."', mistake:'Lunging and getting off balance.', stop:'Shields and bags only; save live contact for coached practice.'},
      ],
      old:[
        {title:'Pass sets & run blocking (bags/sled)', dur:'20 min', why:'A varsity O-lineman mirrors rushers in pass pro and drives on run blocks — technique built on bags and sleds.', how:['Kick-slide sets vs a speed rush (cone or parent, no contact)','Drive and combo footwork into a sled or bag','Hand timing, inside hands, and hip roll'], say:'"Set square, strike inside, roll your hips, finish."', mistake:'Overextending or getting narrow-based.', stop:'Bags and sleds only; live contact at coached practice.'},
      ],
    },
  },
  baseball:{
    P:{
      young:[
        {title:'Balance & throw', dur:'8–10 min', why:'Young pitchers build a smooth motion from balance, not speed.', how:['Balance on the back leg, then stride and throw','15 easy throws to a target, hit the glove','Reset each time'], say:'"Balance, stride, and throw to the glove."', mistake:'Rushing forward off balance.', stop:'Limit throws — protect young arms; no chasing velocity.'},
      ],
      mid:[
        {title:'Mechanics & control', dur:'15 min', why:'Repeatable mechanics build control — control matters far more than speed at this age.', how:['Warm up the arm gradually','Work the motion: balance, stride, land, release to spots','Throw to inside and outside targets, track strikes'], say:'"Same motion, hit your spots — control over speed."', mistake:'Overthrowing for velocity.', stop:'Respect pitch counts and rest days; any elbow or shoulder pain, stop and rest.'},
      ],
      old:[
        {title:'Mechanics, mix & command', dur:'20 min', why:'A varsity pitcher repeats mechanics, commands the zone, and changes speeds — health first.', how:['Full windup and stretch, deliver to spots','Command inside/outside and change speeds','Track a bullpen; note strikes and misses'], say:'"Repeat it, command it, change speeds — win the at-bat."', mistake:'Chasing velocity over command.', stop:'Strict pitch counts and rest days; any arm pain, stop immediately.'},
      ],
    },
    C:{
      young:[
        {title:'Receiving & blocking (soft ball)', dur:'8–10 min', why:'Catching and blocking start with a relaxed, ready stance and soft hands.', how:['Receive soft tosses, giving a target','Practice dropping to block a ball in front','Use a soft ball to stay safe'], say:'"Give a target, receive it soft, block it in front."', mistake:'Stabbing at the ball.', stop:'Soft ball only for young catchers; full gear at practice.'},
      ],
      mid:[
        {title:'Framing & footwork', dur:'15 min', why:'Quiet receiving and quick feet make a catcher a difference-maker.', how:['Frame borderline pitches quietly to the zone','Throw-down footwork: catch, replace the feet, throw','Blocking drops to both sides'], say:'"Quiet glove, quick feet, strong throw."', mistake:'Jabbing the glove or slow feet.', stop:'Warm up the arm; rest to protect it.'},
      ],
      old:[
        {title:'Receiving, blocking & pop time', dur:'20 min', why:'A varsity catcher steals strikes, blocks everything, and controls the run game with pop time.', how:['One-knee framing and quiet receiving','Blocking to both sides, keeping it in front','Throw-down footwork for pop time (catch, replace, throw)'], say:'"Steal strikes, block it, quick transfer, gun it down."', mistake:'Slow transfer or stabbing at pitches.', stop:'Warm up the arm; manage throwing volume.'},
      ],
    },
    "1B":_BB_IF, "2B":_BB_IF, "3B":_BB_IF, SS:_BB_IF, UTIL:_BB_IF,
    OF:{
      young:[
        {title:'Fly balls & drop step', dur:'8–10 min', why:'Tracking fly balls and a good first step are the outfielder basics.', how:['Catch 10 soft fly balls with two hands overhead','Practice a drop step and go on a point','Get behind the ball'], say:'"Two hands up, catch it over your head."', mistake:'Backpedaling instead of turning and running.', stop:'Soft balls; keep it fun.'},
      ],
      mid:[
        {title:'Reads & throws', dur:'15 min', why:'Good routes and strong, accurate throws turn hits into outs.', how:['Take routes to fly balls, catch on the throwing side','Crow-hop and throw to a cut-off target','Field grounders and throw on line'], say:'"Good route, catch it moving, crow-hop and throw."', mistake:'Lazy routes or throwing flat-footed.', stop:'Warm up the arm; respect fatigue.'},
      ],
      old:[
        {title:'Routes, reads & throwing', dur:'20 min', why:'A varsity outfielder reads the ball off the bat, runs efficient routes, and throws with carry to bases.', how:['First-step reads and efficient routes, catch on the throwing side','Crow-hop and hit cut-offs on a line','Do-or-die charge vs drop-step reads'], say:'"Read it, efficient route, catch and throw through it."', mistake:'Drifting routes or throwing flat-footed.', stop:'Warm up the arm; respect fatigue.'},
      ],
    },
  },
  basketball:{
    PG:{
      young:[
        {title:'Handle both hands', dur:'8–10 min', why:'A point guard is comfortable with the ball — built through lots of touches.', how:['Dribble 30s right, 30s left, eyes up','Walk and dribble to targets','Simple crossover between cones'], say:'"Fingertips, eyes up, ball on a string."', mistake:'Slapping with the palm and staring down.', stop:'Keep it playful.'},
      ],
      mid:[
        {title:'Handle, passing & pick-and-roll', dur:'15 min', why:'Guards run the team — handling under control and passing on time.', how:['Two-ball or crossover dribble series','Chest and bounce passes to targets on the move','Walk through a basic pick-and-roll read'], say:'"Change speeds, head up, deliver on time."', mistake:'Killing the dribble with no plan.', stop:'Rest if handles get sloppy.'},
      ],
      old:[
        {title:'Ball-screen reads, pace & passing', dur:'20 min', why:'A varsity point guard controls tempo, reads ball screens, and passes on time off the live dribble.', how:['Change-of-pace handle and hesitations','Ball-screen reads: reject, snake, and pull-up','Live-dribble passing and a finishing package'], say:'"Control the pace, read the screen, make the right pass."', mistake:'Picking up the dribble with no plan.', stop:'Rest handles and knees.'},
      ],
    },
    SG:{
      young:[
        {title:'Form shooting', dur:'8–10 min', why:'Clean form up close now becomes a real shot later.', how:['Form shots 3 feet from the rim, perfect arc','One hand, then add the guide hand','20 makes with a good follow-through'], say:'"Balance, eyes, elbow in, follow through."', mistake:'Shooting from too far with broken form.', stop:'Stop if the shot gets flat or heaved.'},
      ],
      mid:[
        {title:'Catch-and-shoot & footwork', dur:'15 min', why:'Shooting guards score by being ready to shoot on the catch.', how:['Hop or 1-2 into the shot on the catch','Catch-and-shoot from 5 spots','Add a shot fake into one-dribble pull-up'], say:'"Feet ready before the catch, same shot every time."', mistake:'Catching flat-footed and rushing.', stop:'Rest to keep form clean.'},
      ],
      old:[
        {title:'Movement shooting & shot creation', dur:'20 min', why:'A varsity two-guard scores off movement and creates their own shot under control.', how:['Catch-and-shoot off screens and relocations','One-dribble pull-ups both directions','Footwork into a step-back; finish with free throws'], say:'"Ready feet, same shot — off the catch or off the bounce."', mistake:'Rushing or drifting on the jumper.', stop:'Rest to keep form clean.'},
      ],
    },
    SF:{
      young:[
        {title:'All-around wing', dur:'8–10 min', why:'Small forwards do a bit of everything — handle, shoot, and drive.', how:['Layups both sides','Form shots up close','Dribble a cone slalom, both hands'], say:'"A little of everything, under control."', mistake:'Only using the strong hand.', stop:'Keep it fun and varied.'},
      ],
      mid:[
        {title:'Wing scoring & defense', dur:'15 min', why:'Wings score off the catch and drive, and guard the other team\'s best player.', how:['Catch-and-shoot and drive-to-finish from the wing','One-to-two-dribble pull-ups','Defensive slides and closeouts'], say:'"Score it or defend it — be the two-way wing."', mistake:'Standing still on defense.', stop:'Rest between reps; hydrate.'},
      ],
      old:[
        {title:'Two-way wing skills', dur:'20 min', why:'A varsity wing scores three ways and guards the opponent\'s best perimeter player.', how:['Shot-making off the catch and off the drive','On-ball defense: slides, closeouts, and contests','Transition finishing; conditioning'], say:'"Be the two-way wing — get a bucket, get a stop."', mistake:'Coasting on defense.', stop:'Hydrate; rest between reps.'},
      ],
    },
    PF:_BK_BIG, C:_BK_BIG,
  },
  soccer:{
    GK:{
      young:[
        {title:'Hands & ready stance', dur:'8–10 min', why:'A goalkeeper catches with confidence from a balanced, ready stance.', how:['Set the feet, hands ready, catch soft rolls and tosses','Make a "W" with the hands for high balls, scoop low balls','Hug every catch into the body'], say:'"Set, watch it in, and hug it tight."', mistake:'Catching with stiff, flat hands.', stop:'Soft balls; no diving onto hard ground.'},
      ],
      mid:[
        {title:'Shot-stopping & distribution', dur:'15 min', why:'Set feet, good angles, and clean distribution are the keeper core.', how:['Set-and-catch on shots to both sides','Low dives onto a soft surface only','Roll and throw to a target, then a short goal kick'], say:'"Set feet, big body, catch and start the attack."', mistake:'Diving before setting the feet.', stop:'Dive only on soft ground or mats; protect the wrists and hips.'},
      ],
      old:[
        {title:'Shot-stopping, crosses & distribution', dur:'20 min', why:'A varsity keeper sets angles, claims crosses, and launches attacks with clean distribution.', how:['Set-and-save both sides with proper angles','High-ball catching and boxing on a soft surface','Footwork and quick roll/throw and goal-kick distribution'], say:'"Set your angle, claim it, then start the break."', mistake:'Diving before setting the feet.', stop:'Dive on soft ground or mats; protect wrists and hips.'},
      ],
    },
    DF:{
      young:[
        {title:'Contain & clear', dur:'8–10 min', why:'Young defenders learn to stay goal-side and clear the ball.', how:['Shuffle to stay in front of a dribbler, do not dive in','Clear the ball firmly with both feet','Jog back to a goal-side position'], say:'"Stay in front, be patient, then clear it."', mistake:'Diving in and getting beaten.', stop:'Non-contact; keep it fun.'},
      ],
      mid:[
        {title:'Defending & playing out', dur:'15 min', why:'Good 1v1 defending plus calm passing out of the back make a modern defender.', how:['1v1 contain and jockey, win the ball clean','Pass out under light pressure, both feet','Defensive header on a soft tossed ball'], say:'"Patient, goal-side, win it clean, then play."', mistake:'Rushing the tackle.', stop:'Soft ball for headers; rest as needed.'},
      ],
      old:[
        {title:'Defending, heading & building out', dur:'20 min', why:'A varsity defender wins 1v1s, is strong in the air, and builds calmly out of the back.', how:['1v1 defending and recovery runs','Defensive headers on served balls (soft ball)','Passing out under pressure and switching play'], say:'"Win your duel, be strong in the air, then play out."', mistake:'Diving into tackles or panicking on the ball.', stop:'Soft ball for headers; rest as needed.'},
      ],
    },
    MF:{
      young:[
        {title:'Dribble & pass', dur:'8–10 min', why:'Midfielders touch the ball most — comfort dribbling and passing is key.', how:['Dribble a cone slalom, close touches, both feet','Pass to a wall or parent, cushion the return','Freeze on stop, go on go'], say:'"Small touches, head up, find the pass."', mistake:'Only using the strong foot.', stop:'Keep it playful.'},
      ],
      mid:[
        {title:'First touch, vision & range', dur:'15 min', why:'A great first touch and passing range let a midfielder control the game.', how:['Receive across the body and play the next pass','Short and long passing to targets, both feet','Turn out of pressure (cone), then pass'], say:'"Touch away from pressure, head up, pick the pass."', mistake:'A heavy first touch under pressure.', stop:'Rest if touches get sloppy.'},
      ],
      old:[
        {title:'Receiving under pressure, range & transition', dur:'20 min', why:'A varsity midfielder receives on the half-turn, switches play, and reads transition both ways.', how:['Receive on the half-turn and switch the point of play','Short-and-long passing range to targets, both feet','Transition reads: win it and break, or recover and defend'], say:'"Half-turn, head up, switch it or split it."', mistake:'Facing your own goal on every touch.', stop:'Warm up; rest touches if sloppy.'},
      ],
    },
    FW:_SOC_ATT, WING:_SOC_ATT,
  },
  cheer:{
    BASE:_CHEER_STUNT, BACK:_CHEER_STUNT,
    FLY:{
      young:[
        {title:'Tight body & flexibility', dur:'8–10 min', why:'Flyers stay safe by being tight and flexible — trained on the ground, never in the air at home.', how:['Hollow-body holds for total-body tightness, 3×15s','Stretch for a straight jump and scale','Balance on one foot, tall and squeezed'], say:'"Tight everywhere, toes pointed, still as a statue."', mistake:'Being loose or practicing lifts at home.', stop:'No stunting or being lifted at home — gym, coach, and mats only.'},
      ],
      mid:[
        {title:'Flyer strength & flexibility', dur:'15 min', why:'Core strength and flexibility let a flyer hold body positions safely.', how:['Hollow and arch holds, 3×20s','Splits and scale flexibility work','Single-leg balance and tightness holds'], say:'"Strong core, tight body — safe skills at the gym."', mistake:'Practicing stunts outside coached practice.', stop:'Stunting only at the gym with coaches and mats.'},
      ],
      old:[
        {title:'Body positions & flexibility (ground)', dur:'20 min', why:'An advanced flyer holds tight body positions and elite flexibility — trained on the ground, never lifted at home.', how:['Hollow, arch, and total-body tightness holds, 3 sets','Splits, scale, and bow-and-arrow flexibility','Single-leg balance and controlled body-position holds'], say:'"Tight and flexible on the ground; fly only at the gym."', mistake:'Practicing lifts or being tossed at home.', stop:'Never stunt or be lifted at home — gym, coach, and mats only.'},
      ],
    },
    JUMP:{
      young:[
        {title:'Mini-jumps & motions', dur:'8–10 min', why:'Sharp arm motions and small jumps onto a soft surface are the base of every jump.', how:['High-V, T, Touchdown — sharp and held','5 tuck jumps onto grass or a mat','Tall, strong stance between jumps'], say:'"Sharp arms, big smile, soft landing."', mistake:'Floppy arms or hard landings.', stop:'Jump onto soft ground; no tumbling at home.'},
      ],
      mid:[
        {title:'Jump technique', dur:'15 min', why:'Higher toe-touches and pikes come from core strength and clean form.', how:['5 tuck jumps — knees up, land soft and quiet','Seated toe-touch stretch for hip flexibility','3× jump straight into a motion'], say:'"Lift from the core, point the toes, land soft."', mistake:'Leading with the head or crashing the landing.', stop:'Tumbling and stunting only at the gym with a coach and mats.'},
      ],
      old:[
        {title:'Advanced jump technique', dur:'20 min', why:'Big toe-touches, pikes, and hurdlers come from power, flexibility, and clean form.', how:['Toe-touch and pike drills for height','Hip-flexor and hamstring flexibility work','Jump-into-motion combos onto a soft surface'], say:'"Snap the legs up, point the toes, land soft."', mistake:'Leading with the head or crashing the landing.', stop:'Soft landings; tumbling and stunting only at the gym with a coach and mats.'},
      ],
    },
    DANCE:{
      young:[
        {title:'Motions & rhythm', dur:'8–10 min', why:'Clean motions and staying on the beat are the base of cheer dance.', how:['Practice sharp motions to a count','Add simple steps on the beat','Hold each pose still'], say:'"Hit every count, sharp and together."', mistake:'Rushing ahead of the beat.', stop:'Keep it fun.'},
      ],
      mid:[
        {title:'Technique & across-the-floor', dur:'15 min', why:'Clean technique and control make a routine look effortless.', how:['Warm up, then a combo slowly, then up to tempo','Balance holds, relevé 10s each side','Sharp, synced motions in a mirror'], say:'"Control it — dance is strength you cannot see."', mistake:'Skipping the warm-up.', stop:'Sharp joint pain — stop and rest.'},
      ],
      old:[
        {title:'Technique & performance', dur:'20 min', why:'Advanced cheer dance is clean center technique, sharp synced motions, and performance quality.', how:['Center technique and turn progressions','Sharp, synced motions and level changes full-out','Film a run and refine timing and sharpness'], say:'"Sharp, synced, and full-out — sell it."', mistake:'Marking instead of performing.', stop:'Warm up fully; sharp joint pain, stop.'},
      ],
    },
    TUMB:{
      young:[
        {title:'Shapes & flexibility', dur:'8–10 min', why:'Tight body shapes and flexibility are the foundation of every tumbling skill — built safely on the ground.', how:['Hollow and arch holds, 3×15s','Bridge hold and a gentle backbend','Handstand kick-ups against a wall'], say:'"Squeeze everything tight, like a superhero."', mistake:'Forcing flexibility or bouncing.', stop:'Tumbling belongs at the gym with a coach and mats — not on hard ground.'},
      ],
      mid:[
        {title:'Tumbling conditioning', dur:'15 min', why:'Strong core, shoulders, and wrists keep tumblers safe as skills progress.', how:['Hollow-body and arch holds, 3×20s','Wall handstand holds, 3×15–20s','Wrist and shoulder prep'], say:'"Strong and tight first, then skills at the gym."', mistake:'Trying new passes without a coach and mats.', stop:'Never tumble on hard ground; gym, coach, and mats only.'},
      ],
      old:[
        {title:'Advanced conditioning (ground)', dur:'20 min', why:'Elite tumbling is built on serious strength and shapes — the conditioning is done at home, the passes at the gym.', how:['Hollow, arch, and handstand strength holds, 3 sets','Wrist, shoulder, and ankle prep','Block-and-set and punch drills on the floor'], say:'"Own the strength here; tumble at the gym with a coach."', mistake:'Throwing new passes anywhere but coached practice.', stop:'All tumbling at the gym with a coach and mats — never on hard ground.'},
      ],
    },
    AA:{
      young:[
        {title:'Motions, jumps & voice', dur:'8–10 min', why:'All-around cheerleaders build sharp motions, small jumps, and a loud voice together.', how:['Motion sequence, sharp and held','5 tuck jumps onto a soft surface','Call the chant loud and clear'], say:'"Sharp, loud, and full of energy."', mistake:'Soft motions or a quiet voice.', stop:'Soft landings; no stunting or tumbling at home.'},
      ],
      mid:[
        {title:'All-around skills', dur:'15 min', why:'Bringing motions, jumps, voice, and conditioning together builds a complete cheerleader.', how:['Jump technique reps','Motion and chant in a mirror, synced','Core and shoulder conditioning'], say:'"Do it all — sharp, strong, and loud."', mistake:'Neglecting conditioning.', stop:'Stunting and tumbling only at the gym with a coach and mats.'},
      ],
      old:[
        {title:'All-around conditioning & skills', dur:'20 min', why:'A complete cheerleader brings jumps, motions, voice, and real conditioning together.', how:['Advanced jump technique reps','Motions and chant, synced and full-out','Core, shoulder, and leg conditioning'], say:'"Sharp, strong, and loud — do it all."', mistake:'Skipping conditioning.', stop:'Stunting and tumbling only at the gym with a coach and mats.'},
      ],
    },
  },
  softball:{
    P:{
      young:[
        {title:'Windmill basics', dur:'8–10 min', why:'The windmill motion is different from overhand — a smooth arm circle and a firm wrist snap.', how:['Practice the arm circle slowly, brushing the hip','Wrist snaps for spin, 15 easy pitches to a target','Step and release together'], say:'"Big smooth circle, snap at the hip."', mistake:'Muscling it instead of a relaxed circle.', stop:'Keep volume low; protect young arms and shoulders.'},
      ],
      mid:[
        {title:'Windmill mechanics & control', dur:'15 min', why:'A repeatable windmill and hitting spots matter far more than speed.', how:['Warm up the arm gradually','Full windmill to inside and outside targets','Track strikes; add a change-up feel'], say:'"Same circle, snap, and spot — control first."', mistake:'Overthrowing for speed.', stop:'Respect pitch counts and rest; any shoulder pain, stop.'},
      ],
      old:[
        {title:'Windmill mix & command', dur:'20 min', why:'A varsity pitcher repeats the windmill, commands the zone, and mixes speeds and movement.', how:['Full windmill to spots, both corners','Change speeds and add movement (feel for spin)','Command inside and outside; track a bullpen'], say:'"Repeat it, command it, mix it — win the at-bat."', mistake:'Chasing speed over command.', stop:'Respect pitch counts and rest; any shoulder pain, stop.'},
      ],
    },
    C:{
      young:[
        {title:'Receiving & blocking', dur:'8–10 min', why:'Catching and blocking start with a ready stance and soft, secure hands.', how:['Receive soft tosses, giving a target','Drop and block a ball in front','Secure with two hands'], say:'"Give a target, receive it soft, block it in front."', mistake:'Stabbing at the ball.', stop:'Soft ball for young catchers; full gear at practice.'},
      ],
      mid:[
        {title:'Framing & throw-downs', dur:'15 min', why:'Quiet receiving and quick feet control the running game.', how:['Frame borderline pitches quietly','Throw-down footwork: catch, replace the feet, throw to a base','Blocks to both sides'], say:'"Quiet glove, quick feet, strong throw."', mistake:'Slow feet on throw-downs.', stop:'Warm up the arm; rest it.'},
      ],
      old:[
        {title:'Receiving, blocking & pop time', dur:'20 min', why:'A varsity catcher frames strikes, blocks everything, and controls the run game with a quick pop time.', how:['One-knee framing and quiet receiving','Blocking to both sides, keeping it in front','Throw-down footwork for pop time (catch, replace, throw)'], say:'"Steal strikes, block it, quick transfer, throw them out."', mistake:'Slow transfer or stabbing at pitches.', stop:'Warm up the arm; manage throwing volume.'},
      ],
    },
    IF:_BB_IF, UTIL:_BB_IF,
    OF:{
      young:[
        {title:'Fly balls & drop step', dur:'8–10 min', why:'Tracking fly balls and a good first step are the outfield basics.', how:['Catch soft fly balls with two hands overhead','Drop step and go on a point','Get behind the ball'], say:'"Two hands up, catch it over your head."', mistake:'Backpedaling instead of turning and running.', stop:'Soft balls; keep it fun.'},
      ],
      mid:[
        {title:'Reads & throws', dur:'15 min', why:'Good routes and strong, accurate throws turn hits into outs.', how:['Routes to fly balls, catch on the throwing side','Crow-hop and throw to a cut-off','Field grounders and throw on line'], say:'"Good route, catch it moving, crow-hop and throw."', mistake:'Lazy routes or flat-footed throws.', stop:'Warm up the arm; respect fatigue.'},
      ],
      old:[
        {title:'Routes, reads & throwing', dur:'20 min', why:'A varsity outfielder reads the ball off the bat, runs efficient routes, and throws with carry.', how:['First-step reads and efficient routes, catch on the throwing side','Crow-hop and hit cut-offs on a line','Do-or-die charge vs drop-step reads'], say:'"Read it, efficient route, catch and throw through it."', mistake:'Drifting routes or throwing flat-footed.', stop:'Warm up the arm; respect fatigue.'},
      ],
    },
  },
  volleyball:{
    OH:_VB_HIT, OPP:_VB_HIT,
    MB:{
      young:[
        {title:'Block & jump', dur:'8–10 min', why:'Middle blockers jump a lot — clean footwork and hands pressing over start young.', how:['Practice a block jump: press the hands, land balanced','Quick side shuffle into a block jump','Approach and swing at a high ball'], say:'"Press your hands, jump tall, land soft."', mistake:'Swinging arms instead of pressing over.', stop:'Jump onto a good surface; soft ball.'},
      ],
      mid:[
        {title:'Blocking footwork & quick attack', dur:'15 min', why:'Fast feet to block and a quick approach make a middle a weapon.', how:['Block footwork to the pins and back','Quick-set approach and swing timing','Press and seal the hands over the net'], say:'"Read, move, press — jump on time."', mistake:'Late feet and floating the block.', stop:'Land soft; rest the knees and shoulder.'},
      ],
      old:[
        {title:'Blocking reads & quick attack', dur:'20 min', why:'A varsity middle reads the setter, closes the block, and hits a fast-tempo quick.', how:['Read-block footwork closing to the pins','Seal and press the hands over the net','Quick-tempo approach and swing timing'], say:'"Read the setter, close the block, hit on time."', mistake:'Late feet or a floating block.', stop:'Land soft; rest knees and shoulder.'},
      ],
    },
    S:{
      young:[
        {title:'Setting hands', dur:'8–10 min', why:'Soft, symmetric hands and moving to the ball are the setter core.', how:['Set to yourself, 10 in a row, ball off the fingerpads','Set to a wall or parent, quiet hands','Move the feet under the ball, face your target'], say:'"Hands to your forehead, push through, face your hitter."', mistake:'Setting off the palms or catch-and-throw.', stop:'Soft ball for young hands.'},
      ],
      mid:[
        {title:'Footwork & set locations', dur:'15 min', why:'Getting to the ball early and delivering hittable sets runs the whole offense.', how:['Move to the target spot, square up, set','Set to different spots (pin, middle, back)','Quick, quiet release'], say:'"Beat the ball, square up, deliver a hittable set."', mistake:'Setting on the move without squaring up.', stop:'Rest wrists and fingers if sore.'},
      ],
      old:[
        {title:'Tempo, location & running an offense', dur:'20 min', why:'A varsity setter controls tempo, hits every location, and runs an offense with quiet hands under pressure.', how:['Footwork to the target and square-up','Set tempo and location to all spots (1s, gos, back sets)','Run a simple offense; set out of serve-receive'], say:'"Beat the ball, quiet hands, run your offense."', mistake:'Setting on the move without squaring up.', stop:'Rest wrists and fingers.'},
      ],
    },
    L:_VB_BACK, DS:_VB_BACK,
  },
  track:{
    SPR:{
      young:[
        {title:'Fast feet & short runs', dur:'8–10 min', why:'Sprinting is natural — short, fun runs build speed without formal training.', how:['4 × 15-yard runs, accelerate then relax, full walk-back','High-knees and quick skips','Races to a cone'], say:'"Tall, quick feet, relaxed face."', mistake:'Sprinting hard with no warm-up.', stop:'Full recovery between runs; keep it fun.'},
      ],
      mid:[
        {title:'Sprint mechanics & acceleration', dur:'15 min', why:'Good mechanics and drive make every sprinter faster and safer.', how:['A-skips and high-knees, 2× each','4–6 × 20–30 yard accelerations, full recovery','Practice a strong first-step drive'], say:'"Drive out low, then run tall and relaxed."', mistake:'No warm-up or under-resting.', stop:'Full recovery; stop if hamstrings tighten.'},
      ],
      old:[
        {title:'Blocks, acceleration & top speed', dur:'20 min', why:'A varsity sprinter owns the start, the drive phase, and relaxed top-end speed.', how:['Block starts and the drive phase','Acceleration ladder, building distance','Relaxed top-speed strides with full recovery'], say:'"Drive out low, then float at the top — relaxed is fast."', mistake:'Popping up early or tightening up.', stop:'Full warm-up and recovery; stop on hamstring tightness.'},
      ],
    },
    MID:_TR_ENDUR, DIST:_TR_ENDUR,
    HUR:{
      young:[
        {title:'Hurdle mobility & rhythm', dur:'8–10 min', why:'Hurdling starts with hip mobility and rhythm over low objects.', how:['Step over low cones or foam, tall posture','Lead-leg and trail-leg mobility, walking','3-step rhythm between low objects'], say:'"Tall and smooth — step over, do not jump."', mistake:'Jumping the hurdle instead of stepping.', stop:'Use very low, soft objects; no real hurdles young.'},
      ],
      mid:[
        {title:'Hurdle technique', dur:'15 min', why:'Lead and trail-leg technique and 3-step rhythm make hurdling smooth and fast.', how:['Lead-leg and trail-leg drills over low hurdles','Practice 3-step rhythm between hurdles','Stay tall, attack with the lead knee'], say:'"Attack the hurdle, snap the trail leg, keep the rhythm."', mistake:'Floating or breaking rhythm.', stop:'Low hurdles first; stop if form breaks.'},
      ],
      old:[
        {title:'Hurdle rhythm & speed', dur:'20 min', why:'A varsity hurdler holds technique and 3-step rhythm at race speed.', how:['Lead and trail-leg technique over race-height hurdles','3-step rhythm at speed between hurdles','Trail-leg and hip mobility'], say:'"Attack, snap the trail, keep your rhythm at speed."', mistake:'Floating over hurdles or breaking rhythm.', stop:'Progress height gradually; stop if form breaks down.'},
      ],
    },
    JMP:{
      young:[
        {title:'Jump & land', dur:'8–10 min', why:'Young jumpers build spring and safe landings through play.', how:['Two-foot broad jumps onto soft ground, stick the landing','Hop and skip for height','Short run then one-foot takeoff to a soft area'], say:'"Explode up, land soft and balanced."', mistake:'Hard, stiff landings.', stop:'Land on soft ground; low volume.'},
      ],
      mid:[
        {title:'Approach & takeoff', dur:'15 min', why:'A consistent approach and a fast, tall takeoff are the base of long and high jump.', how:['Short controlled approach, hit a takeoff mark','Practice a tall, quick takeoff (no over-jumping)','Bounding and skips for power'], say:'"Steady approach, fast foot down, jump up and out."', mistake:'Slowing down before takeoff.', stop:'Land in a pit or on mats; respect the knees.'},
      ],
      old:[
        {title:'Approach, takeoff & landing', dur:'20 min', why:'A varsity jumper hits a consistent full approach, a fast tall takeoff, and a safe event landing.', how:['Full approach with a consistent takeoff mark','Fast, tall takeoff (no over-jumping)','Event-specific landing (pit or mats); bounding for power'], say:'"Consistent approach, fast foot down, up and out."', mistake:'Decelerating into the takeoff.', stop:'Land in a pit or on mats; respect the knees.'},
      ],
    },
    THR:{
      young:[
        {title:'Throw & follow-through', dur:'8–10 min', why:'Young throwers learn a full-body throw with light objects — never heavy implements.', how:['Overhead throws with a light ball for distance','Rotational throws (twist and throw)','Use the legs and hips, not just the arm'], say:'"Push with your legs, whip your arm last."', mistake:'All-arm throws.', stop:'Light objects only — no shot or discus weight young; always clear the area.'},
      ],
      mid:[
        {title:'Throwing mechanics', dur:'15 min', why:'A legs-hips-arm sequence and balance build safe, powerful throws.', how:['Standing throws with an age-appropriate implement, focus on the sequence','Footwork into the throw (glide or rotation basics)','Balance and follow-through, stay in the ring'], say:'"Big base, legs first, finish tall."', mistake:'Throwing all-arm off balance.', stop:'Age-appropriate weight only; clear the throwing area and never throw toward people.'},
      ],
      old:[
        {title:'Full technique & power', dur:'20 min', why:'A varsity thrower links a full glide or rotation to a powerful, balanced release.', how:['Full glide or rotation footwork with an age-appropriate implement','Legs-hips-arm sequence, staying balanced','Follow-through and stay in the ring'], say:'"Big base, legs lead, arm last, finish tall."', mistake:'Muscling it all-arm and losing balance.', stop:'Age-appropriate weight only; clear the area and never throw toward people.'},
      ],
    },
  },
  gymnastics:{ AA:_GYM_BASE, BB:_GYM_BASE, FX:_GYM_BASE, UB:_GYM_BASE, VT:_GYM_BASE },
  dance:{
    BALLET:{
      young:[
        {title:'Positions & posture', dur:'8–10 min', why:'The five positions, turnout, and tall posture are the ballet foundation.', how:['Practice foot positions 1–5 with gentle turnout','Tall posture, arms in first and second','Relevé balance, 10s each side'], say:'"Tall spine, turn out from the hips, soft arms."', mistake:'Forcing turnout from the knees.', stop:'Turnout comes from the hips — never force the knees.'},
      ],
      mid:[
        {title:'Barre & control', dur:'15 min', why:'Barre work builds the strength, control, and line ballet is known for.', how:['Pliés, tendus, and dégagés with control','Relevé and balance holds','One simple turn (pirouette prep) with spotting'], say:'"Control every inch — quality over quantity."', mistake:'Rushing and losing turnout or posture.', stop:'Sharp knee or ankle pain, stop and rest.'},
      ],
      old:[
        {title:'Barre, center & turns', dur:'20 min', why:'Advanced ballet refines line, control, and turns from full barre through center work.', how:['Full barre with control','Center adagio and turns (pirouettes), spotting as needed','Petit allégro jumps with clean landings'], say:'"Control the line — strength you can see."', mistake:'Rushing and losing turnout or posture.', stop:'Warm up fully; sharp knee or ankle pain, stop.'},
      ],
    },
    JAZZ:_DANCE_TECH, CONTEMP:_DANCE_TECH,
    POM:{
      young:[
        {title:'Sharp motions', dur:'8–10 min', why:'Pom is all about sharp, clean, synced motions and energy.', how:['High-V, T, and clean arm hits, held still','Motions to a count','Big smile and strong stance'], say:'"Hit it and freeze — sharp and strong."', mistake:'Loose, floppy arms.', stop:'Keep it fun.'},
      ],
      mid:[
        {title:'Technique, poms & sync', dur:'15 min', why:'Clean technique and staying perfectly synced is what pom is judged on.', how:['Motion sequence with poms in a mirror, freeze each hit','Add sharp level changes and clean transitions','Film and check timing together'], say:'"Sharp, clean, and together — every hit."', mistake:'Rushing or soft motions.', stop:'Rest as needed; hydrate.'},
      ],
      old:[
        {title:'Technique, sync & performance', dur:'20 min', why:'Advanced pom is razor-sharp motions, tight sync, and full-out performance.', how:['Motion sequences with poms, full-out','Level changes and clean transitions','Film for timing and sync, then refine'], say:'"Every hit sharp and together — sell it."', mistake:'Soft motions or timing drift.', stop:'Hydrate; rest as needed.'},
      ],
    },
    HIPHOP:{
      young:[
        {title:'Isolations & groove', dur:'8–10 min', why:'Hip-hop starts with body isolations and finding the beat.', how:['Isolate head, shoulders, chest, hips','Bounce and groove to the beat','Simple 8-count of basic moves'], say:'"Feel the beat — let it move you."', mistake:'Stiff body, off the beat.', stop:'Keep it fun.'},
      ],
      mid:[
        {title:'Grooves & choreo', dur:'15 min', why:'Cleaner isolations, musicality, and choreography make hip-hop pop.', how:['Warm up isolations','Learn and clean an 8–16 count combo','Hit the accents, control the pauses'], say:'"Hit the accents, control the pauses — make it clean."', mistake:'Marking through instead of full-out.', stop:'Warm up wrists and knees before floor moves.'},
      ],
      old:[
        {title:'Musicality, dynamics & choreo', dur:'20 min', why:'Advanced hip-hop is texture, musicality, and clean choreography performed full-out.', how:['Isolation and mobility warm-up','Learn and clean a longer combo, full-out','Add dynamics: accents, pauses, and controlled floor moves'], say:'"Ride the music — make every accent land."', mistake:'Marking instead of committing.', stop:'Warm up wrists and knees before floorwork.'},
      ],
    },
    TAP:{
      young:[
        {title:'Basic steps & rhythm', dur:'8–10 min', why:'Tap is rhythm through the feet — clear sounds start simple.', how:['Shuffles and toe/heel taps, slow and clear','Step to a steady count','Make each sound clean and separate'], say:'"Relax the ankle, make each sound clear."', mistake:'Tight ankles and muddy sounds.', stop:'Keep it light; hard floors need supportive shoes.'},
      ],
      mid:[
        {title:'Time steps & speed', dur:'15 min', why:'Clean time steps and control let a tapper build speed without losing clarity.', how:['Warm up the ankles','Practice a time step slowly, then faster','Keep the sounds clean as speed increases'], say:'"Clean first, fast second."', mistake:'Speeding up and blurring the sounds.', stop:'Rest ankles if sore.'},
      ],
      old:[
        {title:'Time steps, speed & improv', dur:'20 min', why:'Advanced tap is clean time steps and combinations at speed, plus a little improv.', how:['Warm up the ankles','Drill time steps and combinations for clarity at speed','Add simple improv and trading fours'], say:'"Clean and clear, even fast — then play with it."', mistake:'Blurring the sounds as speed rises.', stop:'Rest ankles; supportive shoes on hard floors.'},
      ],
    },
  },
  tennis:{
    SING:_TEN,
    DOUB:{
      young:_TEN.young,
      mid:[
        {title:'Volleys & net play', dur:'15 min', why:'Doubles is won at the net — punch volleys and good positioning.', how:['Punch forehand and backhand volleys from a feed, short motion','Move to the net after a serve','Communicate and cover with a partner'], say:'"Short punch, move forward, cover together."', mistake:'Swinging big on volleys.', stop:'Warm up; hydrate.'},
      ],
      old:[
        {title:'Net play, poaching & serve patterns', dur:'20 min', why:'Advanced doubles is crisp net play, smart poaching, and serve-and-volley patterns with a partner.', how:['Crisp volleys and overheads from feeds','Poaching movement and I-formation basics','Serve-and-net patterns, communicating with a partner'], say:'"Own the net — move together, finish together."', mistake:'Standing still or swinging big on volleys.', stop:'Warm up the shoulder; hydrate.'},
      ],
    },
  },
  swimming:{ FR:_SWIM_BASE, BK:_SWIM_BASE, BR:_SWIM_BASE, FLY:_SWIM_BASE, IM:_SWIM_BASE, DIST:_SWIM_BASE, SPRINT:_SWIM_BASE },
  wrestling:{ FOLK:_WR, FREE:_WR, GRECO:_WR },
};

// A `drills` row → the same shape the hardcoded library uses, plus provenance.
// Content lives in the DB so drills can be added, corrected and CITED without a deploy;
// program.js stays as the offline/fallback library.
function drillFromRow(r){
  return {
    title:r.title, dur:r.duration||'', why:r.why, how:r.how||[],
    say:r.say||'', mistake:r.mistake||'', stop:r.stop||'',
    band:r.band, sportKey:r.sport_key||null, positionCodes:r.position_codes||[],
    goalKeys:r.goal_keys||[], levels:r.levels||[],
    source_name:r.source_name||null, source_url:r.source_url||null,
    source_note:r.source_note||null, reviewed_on:r.reviewed_on||null,
    images:Array.isArray(r.images)?r.images:[],
  };
}
// Public bucket, so a plain URL works — no signed link, no round trip, and the service
// worker can cache them for a garden with no signal.
function drillImageUrl(path){
  return SUPABASE_URL + '/storage/v1/object/public/drill-images/' + String(path).split('/').map(encodeURIComponent).join('/');
}
// Curated DB drills matching a tier. `codes` null → sport-general (position_codes empty).
function dbDrills(sportKey, band, codes){
  const all=(typeof state!=='undefined' && state.drills)||[];
  return all.filter(d=>d.band===band && d.sportKey===sportKey &&
    (codes===null ? d.positionCodes.length===0
                  : d.positionCodes.some(c=>codes.includes(c))));
}
// A curated row with no sport_key is cited guidance that applies to any athlete of
// this age — it's what covers the sports with nothing curated yet. It ranks behind
// the sport's own content (never displace a drill written for the child's actual
// sport) but ahead of the uncited generic filler.
function dbGenericDrills(band){
  const all=(typeof state!=='undefined' && state.drills)||[];
  return all.filter(d=>d.band===band && !d.sportKey && d.positionCodes.length===0);
}

// Returns the FULL pool of age-appropriate drills, highest-priority first. buildProgram
// rotates through it week to week, so a bigger pool means more variety — it no longer
// caps at 2. Everything here is drawn from the athlete's own band; we never reach up
// into an older band's drills to pad the list.
function skillsFor(sportKey, band, positions, opts){
  const bucket=(band==='littles'||band==='youth')?'young':(band==='preteen')?'mid':'old';
  const posMap=POSITION_SKILLS[sportKey];
  const pool=[], seen=new Set();
  const level=opts&&opts.level;
  // A drill that names levels only applies to those; one that names none applies to all.
  const levelOk=d=>!level || !d.levels || !d.levels.length || d.levels.includes(level);
  const add=x=>{ if(x&&x.title&&!seen.has(x.title)&&levelOk(x)){ seen.add(x.title); pool.push(x); } };
  const listFor=p=>p&&(p[bucket]||p.mid||p.young||p.old);
  const codes=(posMap&&Array.isArray(positions))?positions.filter(c=>posMap[c]):[];
  const wanted=(Array.isArray(positions)?positions:[]);
  // 1) position-specific: curated (cited) first, then the built-in library
  if(wanted.length) dbDrills(sportKey,bucket,wanted).forEach(add);
  codes.forEach(c=>{ const l=listFor(posMap[c]); if(l&&l[0]) add(l[0]); });
  // 2) then each position's remaining drills — this is what feeds the rotation
  codes.forEach(c=>{ (listFor(posMap[c])||[]).slice(1).forEach(add); });
  // 3) sport-general: curated (cited) first again, then this sport's built-in library
  dbDrills(sportKey,bucket,null).forEach(add);
  const sportGeneral=(SKILLS[sportKey] && (SKILLS[sportKey][bucket]||SKILLS[sportKey].mid||SKILLS[sportKey].young||SKILLS[sportKey].old))||null;
  if(sportGeneral) sportGeneral.forEach(add);
  // 4) cited guidance written for any sport. Behind the sport's own drills, ahead of
  //    the uncited filler — so an unmapped sport gets sourced content, not GENERIC_SKILL.
  dbGenericDrills(bucket).forEach(add);
  const fallback=GENERIC_SKILL[bucket]||GENERIC_SKILL.mid;
  // 5) last resort only — keeps generic filler out of a well-covered position's rotation
  if(pool.length<2) fallback.forEach(add);
  if(!pool.length) return fallback;
  // D4: goals reorder the pool. Anything tagged for a chosen goal comes first, so the
  // rotation opens on work that serves what the parent actually asked for. Untagged
  // drills keep their relative order behind it — nothing is ever dropped for a goal.
  const wantKeys=(opts&&Array.isArray(opts.goalKeys))?opts.goalKeys:[];
  if(wantKeys.length){
    const hit=d=>(d.goalKeys||[]).some(k=>wantKeys.includes(k));
    const on=pool.filter(hit), off=pool.filter(d=>!hit(d));
    return on.concat(off);
  }
  return pool;
}

// Whole weeks since a date, compared on local calendar days so DST can't shift a
// boundary. Used to advance the plan every Monday-to-Monday the athlete has existed.
function weeksSince(iso){
  const d=iso?new Date(iso):null;
  if(!d || isNaN(d.getTime())) return 0;
  const n=new Date();
  const start=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
  const today=Date.UTC(n.getFullYear(),n.getMonth(),n.getDate());
  return Math.max(0, Math.floor((today-start)/604800000));
}

// ---- growth velocity ----
// Height is the one intake measurement that can safely change the plan. Around a growth
// spurt bone outpaces the tendons attached to it, which is when knee and heel pain
// (Osgood-Schlatter, Sever's) cluster and coordination temporarily regresses. The right
// response is to hold the load steady, not to add to it.
//
// Deliberately NOT derived from weight. There is no defensible way to turn a child's
// weight into a training decision, and this app will not compute a body-composition
// judgement about somebody's 6-year-old. Weight is recorded for the growth chart only.
const GROWTH_FAST_IN_PER_YEAR = 3.0;   // typical pre-spurt growth runs ~2–2.4 in/yr
const GROWTH_MIN_DAYS   = 60;          // shorter windows are mostly measurement error
const GROWTH_STALE_DAYS = 180;         // an old reading says nothing about today

// One calendar week's roster, season and generated plan, from the Monday weekStart to the Sunday weekEnd. The Week
// screen builds this week with it and Google Calendar sync (js/calendar-sync.js) builds the weeks ahead with it, so a
// synced week is the week the app shows. cancelledIdx are the days (Mon=0) called off that week.
function planForWeek({ age, goals, sports, cancelledIdx, weekStart, weekEnd, heightRows, weekIndex, nameOf }){
  const list=sports||[];
  const primary=list.find(s=>s.is_primary)||list[0];
  const label=nameOf||(k=>k);
  // Every sport the athlete plays, each with its own schedule and season window.
  // buildProgram merges them into ONE weekly load budget.
  const roster=list.map(s=>{
    const ss=s.season_start||null, se=s.season_end||null;
    const pre=!!(ss && weekEnd<ss), off=!!(se && weekStart>se);
    // `gamesOn` gates the GAME DAY only. A sport in preseason camp is still very much
    // active — practices are happening — so it must keep contributing skill work.
    return { sportKey:s.sport_key, sportName:label(s.sport_key), positions:s.positions||[],
             level:s.level||null, practiceDays:s.practice_days||[], gameDay:s.game_day,
             gamesOn:!(pre||off), isPrimary:!!s.is_primary };
  });
  // Games don't exist before the season opens — a weekly game day would otherwise put
  // "Game day" on every Saturday of the preseason.
  const seasonStart=primary?.season_start||null;
  const seasonEnd=primary?.season_end||null;
  const preseason=!!(seasonStart && weekEnd<seasonStart);
  const offseason=!!(seasonEnd && weekStart>seasonEnd);
  const inSeason=!(preseason||offseason);
  const growth=growthSignal(heightRows||[]);
  const sched={ sports:roster, cancelled:cancelledIdx||[],
      practiceDays:primary?.practice_days||[], gameDay:primary?.game_day,
      inSeason, seasonStart, seasonEnd, seasonState:primary?.season_state||null,
      level:primary?.level||null, growth };
  const prog=buildProgram(age, goals||[], primary?.sport_key||'general', primary?.positions||[], weekIndex, sched);
  return { primary, roster, sched, prog, seasonStart, seasonEnd, preseason, offseason, inSeason, growth };
}

function growthSignal(rows){
  const dayGap=(a,b)=>Math.round((new Date(a+'T12:00:00')-new Date(b+'T12:00:00'))/86400000);
  const hs=(rows||[])
    .filter(r=>r && r.metric_key==='height' && r.value!=null && r.measured_on)
    .map(r=>({ v:Number(r.value), on:String(r.measured_on).slice(0,10) }))
    .filter(r=>Number.isFinite(r.v))
    .sort((a,b)=>a.on<b.on?1:-1);            // newest first
  if(hs.length<2) return null;
  const latest=hs[0];
  if(dayGap(isoDay(new Date()), latest.on) > GROWTH_STALE_DAYS) return null;
  // Compare against the most recent reading that is far enough back to be meaningful —
  // two measurements a week apart mostly measure how they stood against the wall.
  const prev=hs.slice(1).find(r=>dayGap(latest.on,r.on)>=GROWTH_MIN_DAYS);
  if(!prev) return null;
  const days=dayGap(latest.on,prev.on);
  const gainIn=latest.v-prev.v;
  if(!(days>0) || gainIn<=0) return null;
  const inPerYear=(gainIn/days)*365;
  if(inPerYear < GROWTH_FAST_IN_PER_YEAR) return null;
  return { inPerYear:Math.round(inPerYear*10)/10, gainIn:Math.round(gainIn*10)/10, days };
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
// ---- goal-driven sessions (D4) ----
// `speed`/`agility`/`endurance` map to the SPEED card and `strength` to the STRENGTH
// card, but the other four goals used to change nothing at all — onboarding told the
// parent "these shape the weekly playbook" and for five of eight options that was false.
// Each of these is a real session that earns its place in the week when it's asked for.
//
// Three buckets, matching skillsFor: young (littles+youth), mid (preteen), old (teen+older).
const GOAL_SESSIONS={
  catching:{
    young:{title:'Hands & catching', dur:'8–10 min', why:'Catching is a trainable skill, not a talent — it comes from lots of easy, successful reps.', how:['20 soft tosses from close up, hands out in front','Say "look it in" on every single one','Step back a pace once 8 of 10 stick','Finish on a catch they made'], say:'"Watch it all the way in — hands out to meet it."', mistake:'Throwing too hard or too far, so most reps are misses.', stop:'When they stop looking the ball in — that\'s focus gone, not effort.'},
    mid:{title:'Sure hands under pressure', dur:'12–15 min', why:'Reliable hands under mild pressure is what separates a good catch from a drop in a game.', how:['20 catches away from the body, thumbs together high, pinkies together low','10 catches while moving, then turn upfield','10 catches with a distraction — a count, a call, a light nudge','Finish clean'], say:'"Late hands, soft hands. Look it all the way in."', mistake:'Trapping it against the chest instead of catching with the hands.', stop:'Any finger or wrist pain → stop for the day.'},
    old:{title:'Hands under pressure', dur:'15–20 min', why:'At this level the catch is rarely the hard part — doing it contested, tired, and in traffic is.', how:['15 catches at full speed, high and low','10 contested reps with a hand in the face','10 catches after a sprint, so it happens tired','Tuck immediately on every rep'], say:'"Catch it first. Everything else comes after."', mistake:'Looking upfield before securing the ball.', stop:'Sharp finger, wrist or shoulder pain → stop.'},
  },
  footwork:{
    young:{title:'Quick feet games', dur:'6–8 min', why:'Foot speed and balance at this age come from play, not from drills.', how:['Hopscotch, forwards and backwards','Line hops: two feet, then one foot, 10 each','Walk a straight line heel-to-toe like a tightrope','Freeze-dance: move, then stop balanced'], say:'"Light and quick — like the floor is hot."', mistake:'Making it a drill instead of a game.', stop:'When it stops being fun.'},
    mid:{title:'Footwork & change of direction', dur:'12–15 min', why:'Sharp feet let them change direction without losing speed — and land safely doing it.', how:['Ladder or chalk squares: 2 feet in each, 4 lengths','5 lateral shuffles each way, staying low','5 plant-and-cut each direction, decelerate before you turn','Rest fully between reps'], say:'"Small fast steps. Sink your hips before you cut."', mistake:'Standing tall through cuts — that\'s where knees get hurt.', stop:'Any knee or ankle pain → stop and rest it.'},
    old:{title:'Change of direction & deceleration', dur:'15–20 min', why:'Most non-contact injuries happen slowing down and turning, not speeding up. Trained deceleration is protection.', how:['Warm up thoroughly first','6 × decelerate-and-plant from a jog, both directions','6 × 5-10-5 shuttle at 80%, full rest between','4 × cut off one leg, landing soft and controlled','Quality over volume — stop while it still looks sharp'], say:'"Land soft, hips down, then explode. Control the stop."', mistake:'Chasing times while the landing gets sloppy.', stop:'Knee pain, or form breaking down → end the session.'},
  },
  iq:{
    young:{title:'Watch the game together', dur:'10 min', why:'Game sense starts with noticing. At this age that\'s a conversation, not homework.', how:['Watch 10 minutes of the sport together','Pause once and ask "where would you go?"','Let them explain — don\'t correct the answer','Name one thing they spotted'], say:'"What did you see there? Show me."', mistake:'Turning it into a lecture or a test.', stop:'When they lose interest — 10 minutes is plenty.'},
    mid:{title:'Read the game', dur:'12–15 min', why:'Knowing what to look for is what makes a player look a step faster without moving any quicker.', how:['Watch 10 min of a game at their position','Pause 3 times: what were the options, what did they pick, why','Pick ONE cue to look for at the next practice','Write it down — one sentence'], say:'"You don\'t have to be faster if you\'re already moving sooner."', mistake:'Watching the ball instead of the position they play.', stop:'Keep it short — this is a thinking session, not a study hall.'},
    old:{title:'Film & self-review', dur:'20 min', why:'Deliberate review is the fastest way to improve at this level — and the habit outlasts the sport.', how:['Film one rep or one series at practice','Watch it twice: once for the outcome, once for the decision','Name one thing that worked, one to change','Take that ONE change into the next session'], say:'"One change at a time. That\'s how it sticks."', mistake:'Cataloguing everything that went wrong and fixing none of it.', stop:'If review turns into self-criticism, stop and go back to what worked.'},
  },
  confidence:{
    young:{title:'Finish on a win', dur:'5–8 min', why:'Confidence at this age is built from ending on something they did well — not from being told they\'re great.', how:['Pick something they can already do','Do it until it works, then stop there','Name exactly what they did: "you kept your eyes on it"','End the session — resist one more go'], say:'"You did that. Remember how it felt."', mistake:'Praising the child instead of the specific thing they did.', stop:'Always end on a success, even a small one.'},
    mid:{title:'Reps that build belief', dur:'10 min', why:'Confidence follows evidence. Stacking reps they can point to beats any pep talk.', how:['Pick one skill just inside what they can do','3 sets of 5 — the goal is the streak, not the difficulty','Track it somewhere they can see it grow','Say what improved, specifically'], say:'"That\'s eight in a row. That\'s not luck any more."', mistake:'Jumping to the hard version before the easy one is automatic.', stop:'If frustration takes over, drop the difficulty and finish clean.'},
    old:{title:'Pressure reps & routine', dur:'12–15 min', why:'Nerves don\'t go away at this level — a repeatable routine is what keeps them from mattering.', how:['Build a 3-step pre-rep routine (breath, cue word, go)','10 reps with the routine every single time','Add pressure: a count, a consequence, someone watching','Same routine under pressure — that\'s the whole point'], say:'"Same routine, every rep. It doesn\'t change because the moment does."', mistake:'Only using the routine when it already feels comfortable.', stop:'If anxiety is affecting sleep, appetite or school, talk to a professional — that\'s beyond training.'},
  },
};
const GOAL_BUCKET={littles:'young',youth:'young',preteen:'mid',teen:'old',older:'old'};
function goalCard(key,band){
  const g=GOAL_SESSIONS[key]; if(!g) return null;
  return g[GOAL_BUCKET[band]||'mid']||null;
}

// ---- level → assumed team load (D6) ----
// Level was collected, required, and never reached the engine: a rec 12-year-old's plan
// was identical to a travel 12-year-old's. It must NOT be used to train the committed
// athlete harder — they're the ones already most at risk of overuse. It's used the other
// way round: a high-commitment level implies the team is already taking more days, so
// the app adds less on top. Only consulted when no practice schedule is set, otherwise
// the real schedule is better evidence and this would double-count.
const HIGH_COMMITMENT=/(travel|club|aau|elite|select|academy|varsity|optional|all-star|sectional|national|company|competitive|tournament|utr|usaw)/i;
function levelIsHighCommitment(level){
  if(!level) return false;
  // "Pre-Competitive" and "Novice" read as high-commitment on a naive match but are the
  // entry rungs of their ladders.
  if(/pre-?competitive|novice/i.test(level)) return false;
  return HIGH_COMMITMENT.test(level);
}

// ---- practice-aware scheduling ----
const DAY_LABELS=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
// Total HARD days a week — team practice and games count toward this, not just home
// sessions. This is what actually enforces the app's rest-first promise: the more the
// team trains, the less we add at home. It can only ever shrink the home workload.
const LOAD_BUDGET={littles:3,youth:4,preteen:5,teen:5,older:6};
const MIN_REST_DAYS=2;
// ---- season state ----
// Asked directly in onboarding rather than inferred, because a date range can't tell
// the difference between "our season ended" and "he's switching to basketball".
// It shifts the weekly budget by one and reorders what gets bought with it.
//   in_season      games and practice already fill the week — protect what's left
//   offseason      no games competing for the load; this is where kids actually improve
//   between_sports one sport just ended, the next hasn't started — general athleticism
// `games:false` means this state has no fixtures — a weekly game day is a leftover from
// the last season and must not keep printing "Game day" on every Saturday.
// The offseason bonus is deliberately withheld from the two youngest bands. For a
// six- or nine-year-old the answer to "more offseason capacity" is unstructured play,
// not a fifth session — which is what the rest of this engine already says.
const SEASON_STATE={
  in_season:      {label:'In season',      delta:-1, base:false, games:true,  bonusBands:[]},
  offseason:      {label:'Offseason',      delta:+1, base:false, games:false,
                   bonusBands:['preteen','teen','older']},
  between_sports: {label:'Between sports', delta: 0, base:true,  games:false, bonusBands:[]},
};
function seasonMeta(k){ return SEASON_STATE[k]||null; }
// The delta the budget actually gets, once the band veto is applied.
function seasonDeltaFor(k, band){
  const m=seasonMeta(k); if(!m) return 0;
  if(m.delta>0 && m.bonusBands.indexOf(band)===-1) return 0;
  return m.delta;
}
// A null column shouldn't silently change anyone's plan, so fall back only when the
// family gave us real dates to read.
function deriveSeasonState(o){
  if(o&&o.seasonState&&SEASON_STATE[o.seasonState]) return o.seasonState;
  if(!o) return null;
  const hasDates=!!(o.seasonStart||o.seasonEnd);
  if(!hasDates) return null;
  return o.inSeason===false ? 'offseason' : 'in_season';
}
const PRACTICE={title:'Team practice', dur:'', why:'Practice is today\'s training. Stacking a home session on top of it is the most common way young athletes get overused — and the fastest way to make the sport feel like a chore.', how:['Get there fed, hydrated, and on time','Let the coach coach — today you\'re the parent, not the trainer','Afterwards: name one thing that went well, then let it go'], say:'"I love watching you play."', mistake:'Running your own drills right before or after practice.', stop:'Pain that lasts past the session, limping, or swelling → rest it and check in with a medical pro.'};

const dayDist=(a,b)=>{ const d=Math.abs(a-b); return Math.min(d,7-d); };   // week wraps
function restDay(i,label,sub){ return {d:DAY_LABELS[i],t:'rest',type:'rest',title:label,sub,act:RECOVERY}; }

// Lays the week out around the team's schedule instead of assuming Mon/Tue/Thu + Sat.
function scheduleAroundPractice(o){
  const {band,practiceDays,gameDays=[],sessions,cancelled=[],labels={},growth=null,assumeTeamLoad=false,seasonState=null}=o;
  const days=new Array(7).fill(null);
  // With two sports the day says WHICH one — "Wrestling practice", not "Team practice".
  const lbl=(i,fallback)=>labels[i]?labels[i]+' '+fallback:('Team '+fallback);

  // 1) fixed points we don't control
  practiceDays.forEach(i=>{ days[i]={d:DAY_LABELS[i],t:'practice',type:'practice',title:lbl(i,'practice'),sub:'Coach leads — nothing extra at home',act:PRACTICE}; });
  gameDays.forEach(i=>{ days[i]={d:DAY_LABELS[i],t:'game',type:'game',title:labels[i]?labels[i]+' game day':'Game day',sub:'Compete & have fun',act:GAMEDAY}; });

  // 2) the day before a game is always light — never a hard session
  gameDays.forEach(g=>{ const eve=(g+6)%7; if(!days[eve]) days[eve]=restDay(eve,'Light + mental','Visualize & relax'); });

  // 3) spend what's left of the week's budget on home sessions
  const committed=practiceDays.length+gameDays.length;
  let free=[]; for(let i=0;i<7;i++) if(!days[i]) free.push(i);
  // Hard floor of 2 full rest days a week — the app's own guidance ("keep at least 1–2
  // full days off sport each week"). Counted across the whole week, not just the free
  // days, so the light-before-game day isn't double-counted against the athlete.
  // Growing fast → spend one fewer home session this week. Pediatric guidance is not to
  // add more than 10–20% to a weekly load at a time; a spurt is the wrong week to add
  // anything at all. Practice and games are the coach's call and are left untouched —
  // this can only ever remove work the app itself added.
  // assumeTeamLoad: a travel/club/varsity athlete with no practice schedule filled in is
  // almost certainly training more than we can see. Spend one fewer home session rather
  // than stack on top of a team week we don't know about.
  // Season state moves the budget by one in either direction. The offseason bonus can
  // never eat into rest — MIN_REST_DAYS below is a hard floor that outranks it.
  const seasonDelta=seasonDeltaFor(seasonState, band);
  const budget=(LOAD_BUDGET[band]||4) - (growth?1:0) - (assumeTeamLoad?1:0) + seasonDelta;
  const slots=Math.max(0, Math.min(budget-committed, 7-committed-MIN_REST_DAYS, free.length));

  // 4) spread them: each pick goes as far as possible from every other hard day
  const picks=[];
  for(let n=0;n<slots;n++){
    const taken=[...practiceDays,...gameDays,...picks];
    let best=-1,bestScore=-1;
    free.filter(i=>!picks.includes(i)).forEach(i=>{
      const score=taken.length?Math.min(...taken.map(t=>dayDist(i,t))):9;
      if(score>bestScore){ bestScore=score; best=i; }
    });
    if(best<0) break;
    picks.push(best);
  }
  picks.sort((a,b)=>a-b);
  picks.forEach((i,n)=>{ const s=sessions[n]; if(!s) return;
    const wasCancelled=cancelled.includes(i);
    days[i]={ d:DAY_LABELS[i], t:s.t, type:s.type, title:s.act.title,
      // say plainly that this slot opened up because the team session fell through
      sub:(wasCancelled?'Team session off — try this instead':(s.act.dur||s.sub||'')),
      act:s.act, replaces:wasCancelled||undefined };
  });

  // 5) everything else is rest — active next to a hard day, full otherwise
  const hard=i=>days[i]&&(days[i].t==='practice'||days[i].t==='game'||days[i].t==='train'||days[i].t==='gym');
  for(let i=0;i<7;i++){
    if(days[i]) continue;
    const near=hard((i+6)%7)||hard((i+1)%7);
    days[i]=cancelled.includes(i)
      ? restDay(i,'Team session off','Rest day instead — the week was already full')
      : (near?restDay(i,'Active recovery','Light + stretch'):restDay(i,'Full rest','Recovery builds athletes'));
  }
  return days;
}

const GAMEDAY={title:'Game day', dur:'', why:'Game day is for competing and having fun — not cramming new skills.', how:['Light breakfast + hydrate well','Arrive calm; warm up with the team','After: name one thing that went well and one to work on — then let it go'], say:'"I love watching you play." (skip the play-by-play critique)', mistake:'Coaching from the sideline or post-game film sessions.', stop:'Any head-injury signs (headache, dizziness, confusion, nausea) → out of play and see a medical pro.'};
const RECOVERY={title:'Active recovery', dur:'', why:'Easy movement on off days helps muscles rebuild and keeps kids fresh.', how:['10–15 min easy walk, bike, or swim','Gentle full-body stretch','Hydrate and get to bed on time'], say:'"Today we recharge — that\'s how we get stronger."', mistake:'Turning rest days into extra training.', stop:'Real soreness or fatigue → take true rest.'};

function buildProgram(age, goals, sportKey, positions, week, schedule){
  const band=ageBand(age);
  const goalKeys=(goals||[]).map(g=>g&&g.key).filter(Boolean);
  const w0=Number.isFinite(week)?Math.max(0,Math.floor(week)):0;
  // Growth signal, computed by the caller from the athlete's height history. When set,
  // the week gets one fewer home session — see growthSignal() for why height and not weight.
  const growth=(schedule&&schedule.growth)||null;
  // D6: only when we have no real schedule to go on — see levelIsHighCommitment().
  const anyPractice=(schedule&&Array.isArray(schedule.sports))
    ? schedule.sports.some(s=>(s.practiceDays||[]).length||s.gameDay!=null)
    : !!(((schedule&&schedule.practiceDays)||[]).length || (schedule&&schedule.gameDay)!=null);
  const rosterLevels=(schedule&&Array.isArray(schedule.sports))
    ? schedule.sports.map(s=>s.level) : [schedule&&schedule.level];
  const assumeTeamLoad=!anyPractice && rosterLevels.some(levelIsHighCommitment);
  // Where in the year this athlete is. Drives the budget, what gets bought with it,
  // and whether a weekly game day exists at all.
  const seasonState=deriveSeasonState(schedule);
  const seasonHasGames=(seasonMeta(seasonState)||{games:true}).games!==false;

  // ---- multi-sport ----
  // A second sport must NOT mean a second full program. Practices and games from every
  // sport count toward ONE weekly budget, and skill work rotates between whichever
  // sports are actually in season. Two sports at once is exactly how a kid ends up
  // training six days a week without anyone noticing.
  const roster=(schedule&&Array.isArray(schedule.sports)&&schedule.sports.length)
    ? schedule.sports
    : [{ sportKey, positions, level:(schedule&&schedule.level)||null,
         practiceDays:(schedule&&schedule.practiceDays)||[],
         gameDay:(schedule&&schedule.gameDay), gamesOn:(schedule?schedule.inSeason!==false:true) }];
  // A sport counts as active if games are running OR practices are on the calendar —
  // preseason camp is active. Only a sport that's genuinely finished drops out.
  const active=roster.filter(s=>s.gamesOn!==false||(s.practiceDays||[]).length);
  const focusPool=(active.length?active:roster);
  const focus=focusPool[w0%focusPool.length];
  const second=focusPool.length>1?focusPool[(w0+1)%focusPool.length]:null;

  const skills=skillsFor(focus.sportKey, band, focus.positions||[], { goalKeys, level:focus.level||null });
  // second sport supplies the other session, so a two-sport week stays varied
  const skillsB=second?skillsFor(second.sportKey, band, second.positions||[], { goalKeys, level:second.level||null }):null;
  const strength=STRENGTH[band];
  const speed=SPEED[band];
  const fuel=fuelCards(band);
  const speedy=goalKeys.some(k=>['speed','agility','endurance'].includes(k));
  // "Build age-safe strength" used to do nothing at all. It now guarantees the strength
  // session survives the load budget instead of being the first thing dropped.
  const wantsStrength=goalKeys.includes('strength');
  // Rotate the pool so the week actually changes week to week instead of repeating the
  // same two sessions forever. Deterministic: the same week always renders the same plan.
  const w=w0;
  const skillA=skills[w%skills.length];
  // With two sports in season the second session comes from the OTHER sport — that's
  // the whole point of playing two, and the app's own content preaches it.
  const crossSport=skillsB&&skillsB.length?skillsB[w%skillsB.length]:null;
  // A sport/position with only one drill in this band would schedule the SAME session
  // twice in one week (hits every athlete with no position picked, every unmapped sport,
  // and any band bucket with a single entry). Fall back to the age-banded speed/movement
  // card rather than repeating Monday — never to another band's drill, which wouldn't
  // be age-appropriate.
  const skillB=crossSport||(skills.length>1?skills[(w+1)%skills.length]:speed[0]);
  // second training day: the speed card if goals ask for it, or if that's all we have
  // The second skill day becomes whatever the parent actually asked for, in the order
  // they picked it: a speed-family goal → the speed card, otherwise the first goal that
  // has a session of its own. Falls back to the second skill drill when no goal applies.
  const firstGoalCard=goalKeys.map(k=>goalCard(k,band)).find(Boolean)||null;
  const thu=speedy?speed[0]:(firstGoalCard||skillB);
  const thuType=(thu===speed[0])?'speed':(thu===firstGoalCard?'goal':'skill');

  // Union the team commitments across every sport, remembering which sport owns each day.
  const dayOwner={};
  const valid=d=>Number.isInteger(d)&&d>=0&&d<=6;
  const allPractice=[]; const allGames=[];
  roster.forEach(s=>{
    (Array.isArray(s.practiceDays)?s.practiceDays:[]).map(Number).filter(valid).forEach(d=>{
      if(!allPractice.includes(d)){ allPractice.push(d); dayOwner[d]=s.sportName||null; }
    });
    // Number(null) and Number('') are both 0 — i.e. Monday. Screen the empty cases out
    // explicitly or "no game day" silently becomes "game every Monday".
    const raw=s.gameDay;
    const g=(raw===null||raw===undefined||raw==='')?NaN:Number(raw);
    // a weekly game day only means something once that sport's season has started —
    // and if the parent told us they're between seasons, it doesn't mean anything at
    // all. Without this, saying "offseason" still printed Game day every Saturday.
    if(valid(g)&&s.gamesOn!==false&&seasonHasGames&&!allPractice.includes(g)&&!allGames.includes(g)){
      allGames.push(g); dayOwner[g]=s.sportName||null;
    }
  });
  allPractice.sort((a,b)=>a-b); allGames.sort((a,b)=>a-b);

  // Cancelled sessions (rain, coach called it off) stop counting as committed load —
  // that's what frees the budget so an at-home session can take the slot instead.
  const cancelled=(schedule&&Array.isArray(schedule.cancelled)?schedule.cancelled:[])
    .map(Number).filter(valid);
  const practiceDays=allPractice.filter(d=>!cancelled.includes(d));
  const gameDays=allGames.filter(d=>!cancelled.includes(d));
  const gameDay=gameDays.length?gameDays[0]:null;   // kept for callers reading a single value

  let days;
  if(allPractice.length||allGames.length||cancelled.length){
    // Home sessions in priority order — with one slot you get skill work, not strength.
    // Littles never get a separate speed session; at that age it's all play.
    // Ordered by priority — the load budget fills from the front, so anything the parent
    // explicitly asked for has to rank above the nice-to-haves or it silently falls off
    // the end of a busy week. A "get faster" goal at this age means chase-and-tag games,
    // not sprint drills, but it still has to change the week.
    const speedSession = {t:'train',type:(band==='littles'?'play':'speed'),act:speed[0]};
    const strengthSession={t:'gym',type:(band==='littles'?'move':'strength'),act:strength[0]};
    const skillASession={t:'train',type:(band==='littles'?'play':'skill'),act:skillA,sub:(band==='littles'?'fun first':undefined)};
    const skillBSession={t:'train',type:(band==='littles'?'play':(thuType)),act:(band==='littles'?skillB:thu)};
    // Priority order — the budget fills from the front, so a stated goal has to outrank
    // the nice-to-haves or a busy week silently drops the very thing that was asked for.
    // Skill work always leads; then every goal the parent chose, in the order they chose
    // it; then the defaults. Deduped by title so "speed + agility" doesn't book the same
    // card twice and crowd the week.
    const goalSessions=[];
    goalKeys.forEach(k=>{
      if(k==='speed'||k==='agility'||k==='endurance') goalSessions.push(speedSession);
      else if(k==='strength') goalSessions.push(strengthSession);
      else { const c=goalCard(k,band); if(c) goalSessions.push({t:'train',type:(band==='littles'?'play':'goal'),act:c}); }
    });
    // Between sports there's no sport to sharpen for, so general athleticism leads:
    // strength and speed before position work. The parent's own goals still outrank
    // both — they didn't stop mattering because the season ended.
    const ordered=(seasonMeta(seasonState)||{}).base
      ? [ ...goalSessions, strengthSession, speedSession, skillASession, skillBSession ]
      : [ skillASession, ...goalSessions, strengthSession, skillBSession ];
    // On the busiest weeks the budget buys exactly ONE home session, and position work
    // would win it every single time — so a stated goal would never actually land. Let
    // the goal lead on alternate weeks instead. Deterministic, and over a month both the
    // sport's own work and the thing the parent asked for get their turn.
    if(goalSessions.length && (w0%2===1)){
      const lead=ordered.shift(); ordered.splice(1,0,lead);
    }
    const seenT=new Set();
    const sessions=ordered.filter(s=>{ const t=s&&s.act&&s.act.title; if(!t||seenT.has(t)) return false; seenT.add(t); return true; });
    days=scheduleAroundPractice({band,practiceDays,gameDays,sessions,cancelled,labels:dayOwner,growth,assumeTeamLoad,seasonState});
  } else if(band==='littles'){
    days=[
      {d:'Mon',t:'train',type:'play',title:skillA.title,sub:skillA.dur+' · fun first',act:skillA},
      {d:'Tue',t:'rest',type:'rest',title:'Free play & rest',sub:'Unstructured play',act:RECOVERY},
      {d:'Wed',t:'train',type:'play',title:(firstGoalCard||skillB).title,sub:(firstGoalCard||skillB).dur,act:(firstGoalCard||skillB)},
      {d:'Thu',t:'rest',type:'rest',title:'Rest',sub:'Recovery & sleep',act:RECOVERY},
      {d:'Fri',t:'gym',type:(speedy?'play':'move'),title:(speedy?speed[0]:strength[0]).title,sub:(speedy?speed[0]:strength[0]).dur+(speedy?' · fast feet':' · movement play'),act:(speedy?speed[0]:strength[0])},
      {d:'Sat',t:'game',type:'game',title:'Game or class',sub:'Have fun',act:GAMEDAY},
      {d:'Sun',t:'rest',type:'rest',title:'Full rest',sub:'Family day',act:RECOVERY},
    ];
  } else {
    days=[
      {d:'Mon',t:'train',type:'skill',title:skillA.title,sub:skillA.dur,act:skillA},
      {d:'Tue',t:'gym',type:'strength',title:strength[0].title,sub:strength[0].dur,act:strength[0]},
      {d:'Wed',t:'rest',type:'rest',title:'Active recovery',sub:'Light + stretch',act:RECOVERY},
      {d:'Thu',t:'train',type:thuType,title:thu.title,sub:thu.dur,act:thu},
      {d:'Fri',t:'rest',type:'rest',title:'Light + mental',sub:'Visualize & relax',act:RECOVERY},
      {d:'Sat',t:'game',type:'game',title:'Game day',sub:'Compete & have fun',act:GAMEDAY},
      {d:'Sun',t:'rest',type:'rest',title:'Full rest',sub:'Recovery builds athletes',act:RECOVERY},
    ];
  }
  // The two fixed templates above don't go through the load budget, so both reductions
  // have to be applied here too — otherwise a growth spurt or an assumed team load would
  // only be respected for families who had filled in a practice schedule. Drops the LAST
  // home sessions; never a game, never a practice.
  if(!(allPractice.length||allGames.length||cancelled.length)){
    // The templates hard-code a Saturday game. Off-season and between sports there
    // isn't one — leaving it there is the app inventing a fixture that doesn't exist.
    const sm=seasonMeta(seasonState);
    if(sm && sm.games===false){
      const sat=days.findIndex(d=>d&&d.t==='game');
      if(sat>=0){
        const filler=sm.base?strength[0]:skillB;
        days[sat]=(band==='littles')
          ? {d:days[sat].d,t:'rest',type:'rest',title:'Free play',sub:'No games this time of year',act:RECOVERY}
          : {d:days[sat].d,t:(sm.base?'gym':'train'),type:(sm.base?'strength':'skill'),
             title:filler.title, sub:filler.dur, act:filler};
      }
    }
    const reasons=[];
    if(growth) reasons.push('Growing fast — easier week');
    if(assumeTeamLoad) reasons.push('Your team likely trains more');
    if(seasonState==='in_season') reasons.push('In season — games come first');
    for(const why of reasons){
      for(let i=days.length-1;i>=0;i--){
        if(days[i] && (days[i].t==='train'||days[i].t==='gym')){
          days[i]={d:days[i].d,t:'rest',type:'rest',title:'Extra recovery',sub:why,act:RECOVERY};
          break;
        }
      }
    }
    // Offseason buys one more session — but only into a day that is already REST-adjacent
    // and never below the two-full-rest-day floor the whole product rests on.
    if(seasonDeltaFor(seasonState,band)>0){
      const hardNow=days.filter(d=>d&&d.t!=='rest').length;
      const cap=(LOAD_BUDGET[band]||4)+seasonDeltaFor(seasonState,band);
      const restIdx=days.map((d,i)=>({d,i})).filter(o=>o.d&&o.d.t==='rest').map(o=>o.i);
      if(restIdx.length>MIN_REST_DAYS && hardNow<cap){
        // take the rest day furthest from any existing hard day
        const hard=days.map((d,i)=>({d,i})).filter(o=>o.d&&o.d.t!=='rest').map(o=>o.i);
        let best=-1,bestScore=-1;
        restIdx.forEach(i=>{ const s=hard.length?Math.min(...hard.map(h=>dayDist(i,h))):9;
          if(s>bestScore){bestScore=s;best=i;} });
        if(best>=0){
          const add=firstGoalCard||strength[0];
          days[best]={d:days[best].d,t:'gym',type:(band==='littles'?'move':'strength'),
                      title:add.title,sub:(add.dur?add.dur+' · ':'')+'Offseason — where kids get better',act:add};
        }
      }
    }
  }
  // If the TEAM's own schedule already eats the week, we add nothing — but say so.
  // Silence would read as "this is a fine amount of training," which it isn't.
  const restDays=days.filter(d=>d.t==='rest').length;
  const homeDays=days.filter(d=>d.t==='train'||d.t==='gym').length;
  const committed=practiceDays.length+gameDays.length;
  const budget=LOAD_BUDGET[band]||4;
  return {band, days, skills, strength, speed, fuel, week:w, practiceDays, gameDay, gameDays,
          restDays, homeDays, committed, budget, cancelled, growth, assumeTeamLoad,
          seasonState, seasonLabel:(seasonMeta(seasonState)||{}).label||null,
          focusSport:focus.sportKey, focusSportName:focus.sportName||null,
          secondSport:second?second.sportKey:null, activeSports:active.length, totalSports:roster.length,
          // Two ways a week can be too much: too few rest days, or the TEAM alone
          // already exceeding what's appropriate for this age. The second used to pass
          // silently — the plan just quietly added nothing and said why but not that.
          overloaded: restDays<MIN_REST_DAYS || committed>budget};
}

const BAND_LINE={littles:'short, playful sessions with lots of rest',youth:'fundamentals and fun — quality over quantity',preteen:'skill focus with age-safe strength and speed',teen:'structured training with form first',older:'progressive training, still form-first'};

// ---- Coach's Corner: peer notes for parents who played the sport ----
const COACH_LEVEL={ kid:'growing up', jr_high:'in junior high', hs:'in high school', college:'in college', pro:'at a high level' };
const COACH_CORNER={
  football:'You know how a clean tuck and a confident first step feel. Demo it slowly yourself, then let them copy you — kids pick up ball security and footwork fastest from a parent who has done it. Praise effort over outcome and keep the reps short.',
  soccer:'You remember that a soft first touch buys time. Show them, then play little 1v1s — your presence and light coaching beat any drill sheet at this age.',
  basketball:'You know footwork and form beat launching threes early. Model a balanced shot up close and celebrate good form, not makes.',
  baseball:'You know the value of watching the ball all the way in and a quick, accurate throw. Slow it down, demo it, and keep arm care front of mind.',
  softball:'You know a relaxed windmill and soft hands matter more than pure speed. Model calm mechanics and protect that young arm.',
  volleyball:'You know platform and footwork win rallies. Show a quiet platform and move your feet — they will copy your calm.',
  track:'You know relaxed speed is fast speed. Model tall, loose running and make rest part of the plan — young engines love the fun stuff.',
  cheer:'You know sharp motions and a strong base come from control, not force. Model clean, held motions — and keep every stunt and tumble at the gym with coaches and mats.',
  gymnastics:'You know tight shapes and flexibility are everything. Model a strong hollow and a clean handstand line at home — leave apparatus skills for the gym.',
  dance:'You know clean lines and musicality separate dancers. Count it out together and model control — your rhythm rubs off.',
  tennis:'You know footwork and a smooth swing beat power. Rally softly, model the split-step, and keep it playful.',
  swimming:'You know a long, flat body glides. Model streamline and easy breathing — and never let them swim without a lifeguard.',
  wrestling:'You know a low stance and motion win before any move. Drill stance and level changes with them — save live wrestling for the mat with a coach.',
};
function coachCornerHTML(){
  if(!state.coach || !state.coach.sportKey) return '';
  const note=COACH_CORNER[state.coach.sportKey]; if(!note) return '';
  const sportName=(state.ref&&state.ref.sports.find(s=>s.key===state.coach.sportKey)||{}).name||'this sport';
  const lvl=COACH_LEVEL[state.coach.level]?(' '+COACH_LEVEL[state.coach.level]):'';
  return `<div class="teach" style="margin-top:14px;background:#EAF3F0;border-color:#CFE3DC"><div class="ic">🧠</div><div><h4>Coach's Corner</h4><p>You played ${esc(sportName)}${esc(lvl)} — so here's a note just for you. ${esc(note)}</p></div></div>`;
}
// Provenance, shown only when it's real. A drill with no source stays visibly uncited —
// silence must never read as implied expert backing.
function fmtReviewed(d){ if(!d) return ''; try{ return new Date(d+'T00:00:00').toLocaleDateString(undefined,{month:'short',year:'numeric'}); }catch(e){ return ''; } }
function sourceHTML(act){
  if(!act) return '';
  if(!act.source_name){
    return `<p style="font-size:11.5px;color:var(--muted);margin:14px 2px 0;line-height:1.45">
      General guidance from the Parent Playbook library — not attributed to an outside source.</p>`;
  }
  const when=fmtReviewed(act.reviewed_on);
  const name=act.source_url
    ? `<a href="${esc(act.source_url)}" target="_blank" rel="noopener noreferrer" style="color:var(--green-d)">${esc(act.source_name)}</a>`
    : esc(act.source_name);
  return `<div style="border-top:1px solid var(--line);margin-top:16px;padding-top:11px">
    <p style="font-size:11.5px;color:var(--muted);margin:0;line-height:1.5">
      <b style="color:var(--ink)">Source:</b> ${name}${when?` · reviewed ${esc(when)}`:''}
      ${act.source_note?`<br><span style="opacity:.85">${esc(act.source_note)}</span>`:''}
    </p></div>`;
}
// ---- completion ----
// The app's week runs Mon..Sun, so day 0 is the Monday of the current calendar week.
function mondayOfThisWeek(){
  const n=new Date(); const d=new Date(n.getFullYear(),n.getMonth(),n.getDate());
  d.setDate(d.getDate()-((d.getDay()+6)%7)); return d;
}
// Kept as a name because eleven call sites read better with it, but it is localDay() from
// js/dates.js and nothing else. Two identical copies of "what day is it here" is one
// copy too many: the sweeps in tests/local-dates.test.cjs and tests/timestamp-day.test.cjs
// guard that helper, and a second private implementation is exactly what they cannot see.
function isoDay(d){ return localDay(d); }
function dateForDayIndex(i){ const d=mondayOfThisWeek(); d.setDate(d.getDate()+i); return isoDay(d); }

// ---- rebalance a missed day ----
// A day that passed unchecked moves to the next open day in the same week and the
// original reads "Moved", not "Missed". Nothing is ever carried into next week and
// nothing turns red — a plan that accuses you is a plan you stop opening.
//
// This is a view transform, not a write: the plan is regenerated from scratch every
// render, so there is nothing to persist and nothing to get out of sync. Load is
// conserved — a session swaps places with a rest day, it is never added on top.
function rebalanceWeek(days, o){
  const {todayIdx, isDone, gameDays=[]} = o;
  const out=days.map(d=>d?{...d}:d);
  // never park work the evening before a game — that day is deliberately light
  const gameEve=new Set(gameDays.map(g=>(g+6)%7));
  const restCount=()=>out.filter(d=>d&&d.t==='rest').length;
  for(let i=0;i<todayIdx;i++){
    const d=out[i];
    if(!d || (d.t!=='train' && d.t!=='gym')) continue;
    if(isDone(i)) continue;
    // A move spends a rest day. Rest-first is a floor, not a preference — if honouring
    // the move would drop the week below it, the session drops instead.
    let target=-1;
    if(restCount()>MIN_REST_DAYS){
      for(let j=Math.max(i+1,todayIdx);j<7;j++){
        if(out[j] && out[j].t==='rest' && !gameEve.has(j)){ target=j; break; }
      }
    }
    if(target<0){
      // Nothing open, or opening one would cost a rest day we don't have. It drops —
      // silently, without blame, and without following them into next week.
      out[i]={d:d.d,t:'moved',type:'moved',title:d.title,sub:'Didn\'t happen — and it doesn\'t carry over',act:d.act,dropped:true};
      continue;
    }
    out[target]={...d, d:out[target].d, moved:true, movedFrom:i,
                 sub:(d.act&&d.act.dur?d.act.dur+' · ':'')+'Moved from '+DAY_LABELS[i]};
    out[i]={d:d.d,t:'moved',type:'moved',title:d.title,sub:'Moved to '+DAY_LABELS[target],act:d.act,movedTo:target};
  }
  return out;
}

// ---- a parent's change to this week ----
// One change a week, chosen by a parent: take a home session off, move it to a rest day, or swap it for
// another card of the same kind. Rest-first is not up for negotiation, so a change can only keep or add
// rest. Skipping turns work into rest; moving swaps a session with a rest day, so neither count changes;
// swapping changes which card fills a day. Anything else is refused and the plan stands as generated.
//
// Applied to the generated plan before rebalancing, so a missed day still moves the way it always has,
// and before the streak judges a week, so a session a parent took off is not counted as undone. Timing
// (a future day, not yet ticked) is checked when the change is made, in weekChangeOptions(); applying it
// checks only that the plan still has that session, so a skipped Tuesday stays skipped on Wednesday.
const WEEK_CHANGE_OPS=['skip','move','swap'];
function weekChangePool(prog, t){
  const pool=t==='gym'?(prog.strength||[]):[...(prog.skills||[]),...(prog.speed||[])];
  const seen=new Set();
  return pool.filter(a=>a&&a.title&&!seen.has(a.title)&&seen.add(a.title));
}
function weekChangeOptions(days, prog, i, o){
  const {todayIdx=0, isDone=()=>false}=o||{};
  const d=days[i];
  if(!d||(d.t!=='train'&&d.t!=='gym')||!d.act||i<todayIdx||isDone(i)) return null;
  // Never the evening before a game (that day is deliberately light), and never a day the team cancelled
  // and the plan kept as rest because the week was already full.
  const gameEve=new Set((prog.gameDays||[]).map(g=>(g+6)%7));
  const moveTo=days.map((x,j)=>({x,j}))
    .filter(({x,j})=>j!==i&&j>=todayIdx&&x&&x.t==='rest'&&!gameEve.has(j)&&x.title!=='Team session off')
    .map(({j})=>j);
  const titles=new Set(days.map(x=>x&&x.title).filter(Boolean));
  const swapFor=weekChangePool(prog,d.t).filter(a=>!titles.has(a.title)).map(a=>a.title);
  return {day:i, title:d.act.title, moveTo, swapFor};
}
function applyWeekChange(days, prog, change){
  if(!change) return {days, applied:false, reason:null};
  const refuse=reason=>({days, applied:false, reason});
  if(!WEEK_CHANGE_OPS.includes(change.op)) return refuse('unknown');
  const i=Number(change.from_day);
  if(!Number.isInteger(i)||i<0||i>6) return refuse('unknown');
  const d=days[i];
  // The plan the change was made against has changed since: a new schedule, a new goal, a new week's card.
  if(!d||!d.act||d.act.title!==change.from_title) return refuse('changed');
  const opts=weekChangeOptions(days, prog, i);
  if(!opts) return refuse('not_changeable');
  const out=days.map(x=>x?{...x}:x);
  if(change.op==='skip'){
    out[i]={d:d.d,t:'rest',type:'rest',title:'Rest instead',sub:'Your call this week',act:RECOVERY,changed:'skip'};
  } else if(change.op==='move'){
    const j=Number(change.to_day);
    if(!opts.moveTo.includes(j)) return refuse('no_room');
    out[j]={...d, d:days[j].d, sub:(d.act.dur?d.act.dur+' · ':'')+'Moved from '+DAY_LABELS[i], changed:'move', changedFrom:i};
    out[i]={d:d.d,t:'rest',type:'rest',title:'Rest',sub:'Session moved to '+DAY_LABELS[j],act:RECOVERY,changed:'move',changedTo:j};
  } else {
    const card=weekChangePool(prog,d.t).find(a=>a.title===change.replacement_title);
    if(!card||!opts.swapFor.includes(card.title)) return refuse('no_swap');
    out[i]={...d, title:card.title, sub:(card.dur?card.dur+' · ':'')+'Swapped in', act:card, changed:'swap'};
  }
  return {days:out, applied:true, reason:null};
}

// ---- week-level streak ----
// Counted in WEEKS, never days. A day-level streak turns a rest day into a loss, and
// the entire argument of this product is that rest is training. Rest days count
// automatically; a week counts when every non-rest day was done or moved.
//
// Past plans aren't stored, so each week is regenerated — buildProgram is pure and
// deterministic, so week N always rebuilds identically. It rebuilds against TODAY's
// schedule and goals; if those changed mid-season an old week can be judged against
// the wrong plan. That's an acceptable error for a streak counter and nowhere else.
function weekStreak(sessionRows, o){
  // cancelledByWeek and changesByWeek are keyed by Monday. When given, each past week is rebuilt with its OWN
  // cancellations and change; without them, every past week borrowed this week's cancellations.
  const {age, goals, sportKey, positions, weekIndex, schedule, maxLookback=26, cancelledByWeek=null, changesByWeek=null}=o;
  const byWeek={};
  (sessionRows||[]).forEach(r=>{
    if(!r||!r.done_on) return;
    const k=isoDay(mondayOf(new Date(r.done_on+'T00:00:00')));
    // Key by DAY AND TITLE, not title alone. A week's plan can use the same title on two
    // days — a five-year-old's speed week carries "Chase & tag games" twice — and deduping
    // by title made those two completed days count as one. `need` counts non-rest DAYS, so
    // the streak became unreachable: a parent who ticked off every day for months still saw
    // zero, the exact opposite of what a week-level streak exists to say.
    //
    // The pair is safe to count because the database enforces
    // UNIQUE (athlete_id, done_on, title): a day cannot contribute the same title twice, so
    // re-ticking cannot inflate the total. Two different titles on one day still count
    // twice, which is what keeps a rebalanced session counting.
    (byWeek[k]=byWeek[k]||new Set()).add(r.done_on+'|'+r.title);
  });
  let streak=0;
  // start at LAST week: this week is still in progress and must never break a streak
  for(let back=1; back<=maxLookback; back++){
    const wi=weekIndex-back;
    if(wi<0) break;
    const monday=mondayWeeksBack(back);
    const key=isoDay(monday);
    const weekSchedule=cancelledByWeek?{...(schedule||{}), cancelled:cancelledByWeek[key]||[]}:schedule;
    const plan=buildProgram(age, goals, sportKey, positions, wi, weekSchedule);
    const change=changesByWeek&&changesByWeek[key];
    const weekDays=change?applyWeekChange(plan.days, plan, change).days:plan.days;
    const need=weekDays.filter(d=>d && d.t!=='rest').length;
    if(need===0){ streak++; continue; }              // an all-rest week still counts
    const got=byWeek[key]?byWeek[key].size:0;
    if(got>=need) streak++; else break;
  }
  return streak;
}
// Whole weeks back from this week's Monday, by CALENDAR days rather than epoch
// milliseconds. Subtracting back*7*86400000 assumes every week is exactly 168 hours; the
// week containing a spring-forward is 167, so the result landed at 23:00 the previous
// Sunday and mondayOf() then snapped it back a further week. Every week before a DST
// change was looked up under the wrong key, so completed weeks read as incomplete and the
// streak broke every spring. setDate() rolls months and years and is unaffected by DST.
function mondayWeeksBack(weeks){
  const m=mondayOfThisWeek();
  return new Date(m.getFullYear(), m.getMonth(), m.getDate()-weeks*7);
}
function mondayOf(d){
  const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());
  x.setDate(x.getDate()-((x.getDay()+6)%7));
  return x;
}

async function markSessionDone(ctx, btn){
  if(!ctx||!ctx.date) return;
  // The same two functions are now called from a sheet button, today's card, AND the
  // round tick on a day row. Restore whatever label was actually there on failure —
  // hardcoding "Mark done" turned a failed tick into a button reading "Mark done".
  const was=btn.innerHTML;
  btn.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; btn.disabled=true;
  // Offline: queue it and move on. A parent standing on a field with one bar should
  // not lose the tick, and should not be told to try again later.
  if(!navigator.onLine && typeof owQueue==='function'){
    await owQueue({ kind_op:'session_done', athlete_id:state.active.id, done_on:ctx.date,
      title:ctx.title, kind:ctx.kind||null, week_index:(ctx.week==null?null:ctx.week),
      created_by:state.user.id });
    toast('Saved — will sync when you\'re back online');
    const bg0=btn.closest('.modal-bg'); if(bg0) bg0.remove();
    return renderApp('week');
  }
  const { error }=await sb.from('sessions').upsert({
    athlete_id:state.active.id, done_on:ctx.date, title:ctx.title,
    kind:ctx.kind||null, week_index:(ctx.week==null?null:ctx.week), created_by:state.user.id,
  },{ onConflict:'athlete_id,done_on,title' });
  if(error){ console.error(error); reportError(error,'week:markDone'); toast('Could not save'); btn.innerHTML=was; btn.disabled=false; return; }
  toast('Nice work 💪');
  const bg=btn.closest('.modal-bg'); if(bg) bg.remove();
  renderApp('week');
}
// Rain day / cancelled practice. Frees that day's load so the plan can offer something
// at home instead — or keep it as rest if the week is already full.
async function markCancelled(ctx, btn, on){
  btn.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; btn.disabled=true;
  let error;
  if(on){
    ({ error }=await sb.from('schedule_exceptions').upsert({
      athlete_id:state.active.id, on_date:ctx.date, kind:(ctx.kind==='game'?'game':'practice'),
      created_by:state.user.id },{ onConflict:'athlete_id,on_date' }));
  } else {
    ({ error }=await sb.from('schedule_exceptions').delete()
      .eq('athlete_id',state.active.id).eq('on_date',ctx.date));
  }
  if(error){ console.error(error); toast('Could not save'); btn.disabled=false; btn.textContent=on?'Mark cancelled':'It happened after all'; return; }
  toast(on?'Marked cancelled — plan updated':'Back on the schedule');
  const bg=btn.closest('.modal-bg'); if(bg) bg.remove();
  renderApp('week');
}

async function undoSessionDone(ctx, btn){
  const was=btn.innerHTML;
  btn.innerHTML='<span class="spinner" role="status" aria-label="Loading"></span>'; btn.disabled=true;
  if(!navigator.onLine && typeof owQueue==='function'){
    await owQueue({ kind_op:'session_undo', athlete_id:state.active.id,
      done_on:ctx.date, title:ctx.title });
    toast('Saved — will sync when you\'re back online');
    const bg0=btn.closest('.modal-bg'); if(bg0) bg0.remove();
    return renderApp('week');
  }
  const { error }=await sb.from('sessions').delete()
    .eq('athlete_id',state.active.id).eq('done_on',ctx.date).eq('title',ctx.title);
  if(error){ console.error(error); reportError(error,'week:undoDone'); toast('Could not undo'); btn.innerHTML=was; btn.disabled=false; return; }
  const bg=btn.closest('.modal-bg'); if(bg) bg.remove();
  renderApp('week');
}

// openActivity moved to js/screen-activity.js — it is a route now, not a sheet.

