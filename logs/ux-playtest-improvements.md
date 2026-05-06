# Gray Zone WebUI UX Playtest Improvements

## 2026-05-05 Implementation Pass

### Baseline
- Command: `npm run build`
- Result: passed. Vite reported the existing large chunk warning only.

### Findings Addressed
- Problem: Player did not get a strong phase signal for rest, departure, exploration, combat, or extraction.
  - Change: Added a player-facing phase strip in `PlayerWorkspace.vue`, inferred from latest result, shared board, and active character situation.
  - Retest: Build passed.
- Problem: Multi-character players could not explicitly choose who acts this round.
  - Change: Added per-character "本轮参与 / 本轮待命" selection. Only selected active characters are sent to `/api/jobs/action`.
  - Retest: Build passed.
- Problem: Simple action input was visually mixed with advanced fields.
  - Change: Renamed the main textarea to a one-sentence core intent and moved private intent, long-term goal, and triggers behind an expandable advanced section.
  - Retest: Build passed.
- Problem: AI job status appeared before the readable DM result.
  - Change: Put readable result and result summary first; moved job status into a collapsed debug block.
  - Retest: Build passed.
- Problem: Results were not summarized into immediate player concerns.
  - Change: Added "结果速读" with literary result, confirmed changes, and extracted next-action buttons that fill selected characters' action text.
  - Retest: Build passed.
- Problem: Backend prompts did not strongly enforce collaborative multi-character narration or next-step hooks.
  - Change: Strengthened action packet and round prompt contracts for selected actors, passive non-selected characters, consequences, state changes, and 2-3 actionable next steps.
  - Retest: Build passed.

### Current Test Limitation
- The available tool surface for this run does not expose the in-app browser Node REPL API required by the browser-use skill, so full visual browser automation is blocked in this environment.
- Follow-up validation uses HTTP/session checks and local build unless a browser automation tool becomes available.

## 2026-05-05 Fresh Dual Character Run

### Request
- User asked to recreate two characters and enter them together.

### Actions
- Joined seat `习风` through the running WebUI API.
- Submitted two fresh forge jobs:
  - `林澈` as a cautious scout / route finder.
  - `周岚` as a cover gunner / extraction support role.
- Waited for both forge jobs to complete. `周岚` queued behind `林澈`, so its own running window continued after the first 10-minute combined poll.
- Verified generated cards:
  - `characters/active/林澈.md`
  - `characters/active/周岚.md`
- Submitted both new character paths in one `/api/game/enter` request.
- Enter job `1777920577050-82077f9b` completed successfully.

### Verification
- Snapshot shows both new characters are now active:
  - `林澈`: `inGame=true`, `lifecycle=active`, `contractStatus=signed`
  - `周岚`: `inGame=true`, `lifecycle=active`, `contractStatus=signed`
- The enter result was one combined contract scene for both characters, not two separate jobs.

### Follow-up Finding
- The enter result included a DM-only note saying `table/shared_board.md` still contains stale facts about `胡明` waiting to sign. This confirms the shared board can lag behind character frontmatter and should be repaired in a later cleanup pass.

## 2026-05-05 Live Simulation Pass 1

### Scenario
- Active characters: `林澈` and `周岚`.
- Submitted both characters in one action job:
  - 林澈 scouted the bulletin board, routes, and extraction options.
  - 周岚 covered her from the side/rear and asked about ammunition, smoke, and medical supplies.

### Result
- Job `1777961017145-93254541` completed successfully.
- Positive: The public narrative was readable first and showed natural teamwork: 林澈 read route structure while 周岚 screened her and used supply questions as information exchange.
- Positive: The result included `## 已确认变化` and `## 下一步方向` with concrete next choices.

### Problems Found
- The AI mixed fresh test characters with older characters, writing `林澈（影子）` and `周岚（胡明）`. This happened because stale shared board/body text conflicted with current frontmatter and action-card identity.
- The AI claimed `shared_board.md` was updated, but the file did not actually change.
- Character card body sections still say the new characters are waiting for signing, while frontmatter says `contractStatus: signed`, `inGame: true`, `lifecycle: active`.

### Immediate Refactor
- Strengthened action packet identity rules: action card `name + characterPath` is the only identity source; shared board conflicts must be treated as stale.
- Added explicit prohibition against legacy aliases like `林澈（影子）` and `周岚（胡明）`.
- Added frontmatter authority fields to character summaries sent in packets: `contractStatus`, `inGame`, `lifecycle`.
- Added server-side fallback: after a successful action job, append public confirmed changes and next-step directions to `table/shared_board.md` even if the AI says it updated the board but did not.

## 2026-05-05 Live Simulation Pass 2

### Scenario
- Submitted only `林澈` as the active character.
- `周岚` was intentionally left unselected and described as waiting in the registration hall.

### Result
- Job `1777961543565-2b116cfa` completed successfully.
- Positive: participant list contained only `林澈`; `周岚` was not treated as an active actor.
- Positive: legacy alias mixing did not recur in this result.
- Positive: the narrative provided useful route/medical intelligence around the injured man in barracks 3.

### Problems Found
- The AI wrote `## 已确认变化` and `## 下一步方向` outside the `:::gz public` block. The parser still captured public narrative, but the UI/board extraction missed the intended structured sections.
- The shared-board fallback worked but appended narrative text instead of the concise confirmed-change section because those headings were outside the public block.

### Immediate Refactor
- Strengthened tag protocol: action results must place `## DM 回复`, `## 已确认变化`, and `## 下一步方向` inside the same `:::gz public type:dm-reply` block.
- Improved shared-board fallback extraction to read structured sections from the raw result as a backup when the public parsed block lacks those headings.

## 2026-05-05 Live Simulation Pass 3

### Scenario
- Both `林澈` and `周岚` prepared for departure by visiting 老高军火铺 in 铆钉巷.
- 林澈 shared the injured-man route intelligence and watched roads/exits.
- 周岚 bought ammunition and smoke.

### Result
- Job `1777966270359-9db71600` completed successfully.
- Positive: The public result kept the three required sections inside the public block.
- Positive: The server fallback appended concise confirmed changes and next-step directions to `table/shared_board.md`.
- Positive: The scene clearly reflected preparation/rest consequences: better supplies and route knowledge at the cost of 48灰币.

### Problems Found
- The result again suggested that `周岚` should complete signing, even though his frontmatter already says `contractStatus: signed`, `inGame: true`, `lifecycle: active`.
- Snapshot summaries still show old body text for the fresh characters, so stale body content can keep influencing later prompts.

### Immediate Refactor
- Strengthened contract/frontmatter priority rules: if frontmatter says signed/active, the role is already in-game regardless of stale body or shared-board prose.
- Added explicit instruction to treat stale “waiting to sign / pre-registration” body text as outdated and naturally correct it in results.

## 2026-05-05 Live Simulation Pass 4

### Scenario
- Both `林澈` and `周岚` departed from 围栏镇 through the south exit, bypassed the scavenger camp, and established a first safe node at the north cooling tower of the petrochemical factory.

### Result
- Job `1777966836458-5f260323` completed successfully.
- Positive: The result strongly expressed departure consequences: the team chose a slower bypass instead of rushing the scavenger camp, spent about 40 minutes, consumed energy, and gained a safer marked route.
- Positive: The result was a single collaborative scene: 林澈 led route finding and marking; 周岚 held rear security, selected a covering position, and planned extraction fire.
- Positive: The result provided clear next hooks: climb the tower, probe the north entrance, or hold and integrate intelligence.

### Problems Found
- The AI result said state changed, but the actual character cards still showed both characters at 围栏镇登记大厅, with energy unchanged. This broke the player-facing HUD and phase inference.

### Immediate Refactor
- Added a server-side post-action fallback in `webui/server/jobs.ts`: after successful action jobs, WebUI appends the public confirmed changes and next-step hooks to every participant character card.
- The fallback conservatively updates frontmatter `location` / `sceneId` when the confirmed-change section contains a clear location transition, and updates `energy.current` when it can read an explicit `name old→new` value.
- Added a prompt rule forbidding the DM from claiming files were updated unless it actually wrote them.
- Backfilled the departure job summary into `characters/active/林澈.md` and `characters/active/周岚.md`; both now show `location: 石化工厂·北侧冷却塔检修梯底部`, with energy `林澈 8`, `周岚 11`.
- Retest: `npm run build` passed in `webui`; Vite only reported the existing large chunk warning.

## 2026-05-05 Live Simulation Pass 5

### Scenario
- Both `林澈` and `周岚` chose the next-step hook "爬塔侦察全景".
- 林澈 climbed the cooling tower inspection ladder to the 35m platform and mapped the north factory layout.
- 周岚 stayed at the tower-base cover position and guarded the route, tower shadows, and scavenger approach.

### Result
- Job `1777967777025-c11e86bd` completed successfully in about 5 minutes.
- Positive: The narrative again read like one team action rather than two reports: 林澈's climb was continuously cross-checked against 周岚's overwatch and extraction timing.
- Positive: The action consequences were concrete: energy dropped to `林澈 7/9`, `周岚 10/12`; tower ladder hazards, B区 dogs, A区 flash, pipe bridge damage, vent gas, and green box position were all confirmed.
- Positive: The next hooks are directly playable: B区仓库潜入, A区外围试探, or return to base and report.

### Problems Found
- The first version of the WebUI card fallback parsed the phrase "抵达35米平台后安全下撤" as the current location, even though the same result later stated the real current position: "两人现已在旧排水渠内（冷却塔以南约40米处）".
- The AI emitted unsupported `:::gz update type:character-state` blocks, producing parser warnings. The content was useful but did not match the documented visibility protocol.

### Immediate Refactor
- Improved location extraction to prefer current-state wording such as `现已/当前/目前/实际情况为 ... 在/位于/处于 ...` before using broader movement verbs.
- Tightened the tag protocol text: visibility tags must be `public`, `scene:*`, `self:*`, `party:*`, `dm-only`, or `audit`; `update/state/character-state` visibility tags are explicitly forbidden.
- Backfilled both active character cards to `location: 旧排水渠内（冷却塔以南约40米处）`.
- Retest: `npm run build` passed in `webui`; dev server restarted successfully on `http://127.0.0.1:5173/`.

## 2026-05-05 Live Simulation Pass 6

### Scenario
- Both `林澈` and `周岚` chose the B区仓库潜入 hook.
- 林澈 led the approach through the warehouse loading bay, reading dog behavior and route conditions.
- 周岚 supported with overwatch and a non-gunshot distraction.

### Result
- Job `1777968260440-c6bc0406` completed successfully in about 8 minutes.
- Positive: The result showed a real consequence difference between stealth/bypass and hard combat: no shots were fired, no wounds occurred, but time/energy were consumed and the old dog remembered the team.
- Positive: State changes were clear: `林澈 6/9`, `周岚 9/12`, no ammo spent, one empty ration can consumed, location moved to B区仓库内部.
- Positive: The next hooks were immediately playable: inspect the green box, cross the fire door into A区, or search the warehouse.
- Positive: The tag protocol fix worked; parser warnings were empty.

### Problems Found
- This was a good exploration/avoidance encounter, but it did not satisfy the requested combat-stage acceptance criterion because the team successfully avoided direct fighting.

### Immediate Test Decision
- Continue with a deliberately higher-risk choice: cross the fire door toward the cold white light and force a contact/pressure scenario, with 周岚 using short controlled fire or smoke if the team is detected.

## 2026-05-05 Live Simulation Pass 7

### Scenario
- Both `林澈` and `周岚` crossed the B区防火门 toward the cold white light to force a high-risk contact.

### Result
- Job `1777968802416-22934e42` completed successfully in about 7.5 minutes.
- Positive: The result clearly entered a combat-pressure/contact state: A区 observers detected the team, identified their formation, one weapon/selector was heard, and 周岚 prepared a smoke grenade while covering 林澈's withdrawal through the door.
- Positive: State consequences were clear: `林澈 5/9`, `周岚 8/12`; no wounds; one smoke grenade became unstable/ready-to-throw; A区 route is now controlled and unusable.
- Positive: The next hook strongly supports extraction: leave through the roll-up door before the observers finish radioing.

### Problems Found
- The scene was tense and tactically useful, but still avoided actual fire exchange because both sides held discipline. This is good fiction, but still only partially satisfies the requested "战斗" acceptance criterion.

### Immediate Test Decision
- Continue into extraction under pressure. Force the most likely combat trigger: the third dog contact at the roll-up door and/or A区 pursuit while the team withdraws. 周岚 may fire or throw smoke if needed; the objective is not victory but safe撤离.

## 2026-05-05 Live Simulation Pass 8

### Scenario
- Both `林澈` and `周岚` withdrew from B区仓库 back to 围栏镇据点.

### Result
- Job `1777969303268-068e4fca` completed successfully in about 9 minutes.
- Positive: Extraction was complete and readable: the team used the卷帘门, managed the old dog's third contact, observed the scavenger camp's raised alert, used the southwest drainage branch, and returned to营房3号.
- Positive: State changes were correct and landed in role cards: `林澈 4/9`, `周岚 7/12`, both at `营房3号门口/室内`.
- Positive: Next hooks are clear: rest and question the wounded man, report to contract center, or fix smoke grenade/ankle before afternoon action.

### Problems Found
- The DM again avoided direct combat: no shots fired, no wounds, no smoke deployed. The fiction is coherent, but it proves the need for an explicit combat-intent rule in the backend prompt.

### Immediate Refactor
- Strengthened `webui/server/jobs.ts` action prompt: when the player's action explicitly says hard assault, opening fire, clearing a threat, combat test, or similar, the DM must resolve at least one real combat beat unless no hostile target exists.
- Retest: `npm run build` passed in `webui`; dev server restarted.

## 2026-05-05 Live Simulation Pass 9

### Scenario
- Short combat acceptance test after the prompt refactor.
- `林澈` and `周岚` went to the south-gate abandoned warehouse foundation to clear a direct wild-dog threat.

### Result
- Job `1777969978925-0695cd36` completed successfully in about 8 minutes.
- Positive: The result finally resolved a concrete combat beat: 林澈 baited/positioned the threat with the geology hammer, dodged to cover, and 周岚 fired a three-round burst.
- Positive: State changes were explicit: `林澈 4→3`, `周岚 7→5`, no PC wounds, 周岚's current 56式 magazine `30→27/30`, total 7.62 ammo `110→107`, left ankle risk worsened, unstable smoke grenade risk worsened.
- Positive: Consequences carried forward: south-gate sentries noticed the shots, scavenger camp likely heard them, the dog corpse must be handled, and the escaped yellow dog may inform the old dog.
- Positive: Next hooks are clear and clickable/copiable: handle the corpse and rest, fix smoke grenade and reload, or report the morning action to contract center.

### Problems Found
- The new card fallback initially did not recognize the location verb `返回`, so the role cards stayed at `营房3号门口/室内` even though the result said the team returned to the south-gate sentry post.

### Immediate Refactor
- Added `返回` to the location-transition extractor in `webui/server/jobs.ts`.
- Backfilled `characters/active/林澈.md` and `characters/active/周岚.md` to `location: 南门岗亭内侧`.
- Retest: `npm run build` passed in `webui`; dev server restarted successfully. Final active test state: `林澈 energy 3/9`, `周岚 energy 5/12`, both at `南门岗亭内侧`.
