# Problem Statement — Whose Turn Is It to Irrigate

Source of truth for scope. Submitted to IEEE-CIS on 2026-10-01.

## Background: warabandi and the case

Warabandi is a rotational canal-sharing system: each farmer gets a fixed turn of time, proportional to landholding, on a weekly roster. It assumes an hour of turn gives the same water everywhere along the canal. The case dialogue shows where that breaks: upstream turns overrun, tail-end flow arrives weak and late, the register shows everyone "got their hours", and schedule changes miss farmers who are not in the chat group.

## Root cause

| Stakeholder | What they said | Underlying failure |
| --- | --- | --- |
| Upstream farmer | "My crop needs water today." | Fixed calendar turns ignore crop stage; no fair way to get water early. |
| Downstream farmer | "You extended your turn; flow was weak." | Overruns and seepage upstream cut the flow reaching the tail. |
| Coordinator | "Everyone received their allotted hours." | The register records time, not delivered water, so unfairness is invisible. |
| Downstream farmer | "Hours are not usable water." | Same hours deliver less volume the farther an outlet is from the head. |
| Small farmer | "I did not see the schedule change." | Changes go out on one chat group, with no check that anyone received them. |

Allocation and records are in hours, but crops need usable water delivered at the field gate, at the right growth stage.

## Problem statement

Time-based rotational irrigation treats equal hours as equal water. Seepage, travel lag and upstream overruns mean tail-end farmers get far less usable water than their turn suggests. The hours register still shows the schedule as fair. Crop needs, rain and urgent requests have no fair way into the schedule, and changes miss farmers outside the chat group. The result is crop stress, disputes and lost trust among farmers who share one canal.

## Key problems

1. **Hours are not water.** Seepage and travel lag mean an hour at a tail-end outlet delivers much less water than an hour at the head.
2. **Allocation ignores crop needs.** Crop type, growth stage, soil and multiple crops per farmer are not considered; no season-start estimate of need exists.
3. **No shared starting agreement.** Entitlements live in personal notebooks and memory.
4. **Release timing is unpredictable.** Water often arrives in the evening or at night; unwarned farmers miss turns or irrigate unsafely in the dark.
5. **Rain is ignored.** Fixed rosters release water after rain; saved water is not held for later.
6. **Urgency is settled by force.** No formal way to request water early; extra water taken is never deducted.
7. **Unused water is wasted.** Skipped turns and post-harvest entitlement are not pooled, and there is no visible way to request them.
8. **Announcements exclude people.** One chat group, no acknowledgement; farmers without smartphones are left out.
9. **Records can't settle disputes.** The register can't show delivered water, so overruns and shortfalls can't be proven.
10. **The coordinator can't do the maths by hand.** A fair schedule across losses, crops, rain and release windows is too complex to plan manually.

## Agreed solution features (team decisions)

- Season-start registration on a local portal: land area, crops (several per farmer), sowing dates, soil, position along the canal.
- AI-suggested seasonal entitlement per crop per week (FAO-56 crop need, weather, effective rain), reviewed and approved by the coordinator.
- Allocation by volume: a canal physics model converts volume into turn duration using the flow that actually reaches each outlet; turns fit inside main-canal release windows.
- Rain re-plans the schedule; saved water goes to the common buffer.
- Urgent requests via portal or phone; coordinator approves; granted volume is deducted from the farmer's seasonal quota.
- Common buffer: unused weekly allowance and post-harvest remainder are pooled; buffer requests are public on the portal and coordinator-approved.
- AI caller agent phones farmers in Telugu; a change is valid only after acknowledgement; evening/night releases get WhatsApp + a warning call.
- A volume ledger replaces the hours register.
