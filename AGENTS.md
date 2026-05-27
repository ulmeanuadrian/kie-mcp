# Agent guidelines — @robos/kie-mcp

Scop: server MCP modern pentru kie.ai, scris from scratch (zero copy din alte implementari), proiectat in jurul a patru diferentiatori:

1. Sync-wait built-in (tool-ul asteapta task-ul si returneaza asset path local)
2. Schema consolidata (5 tool-uri umbrela in loc de N per model)
3. Cost telemetry (kie.ai e ales pentru pret — facem pretul vizibil)
4. Batch compare (un prompt, N modele, paralel)

## Reguli de cod

- **Modules:** ES modules, `.js` extensions in imports din TS.
- **Strict TS:** `strict: true`, `noUnusedLocals`, `noImplicitReturns`.
- **Validation:** Zod pentru orice payload care intra in tool. Schema = sursa de adevar pentru tipuri.
- **No `any`:** preferat `unknown` + narrow.
- **Errors:** wrap-uite in `McpError` cu `ErrorCode` corespunzator inainte de a parasi handler-ul.
- **Naming:** camelCase variabile/functii, PascalCase clase/types.
- **HTTP:** un singur `KieClient` cu `fetch` + retry exponential + timeout. NU `fetch` direct in tool handlers.
- **Asset persistence:** orice URL returnat de kie.ai e descarcat in `KIE_OUTPUT_DIR` si tool-ul returneaza path absolut.
- **Telemetry:** orice call de generare logheaza `(model, credits, ts)` in `costs` table.
- **Determinism:** SQLite append-only pentru audit; idempotency key derivat din `(model, prompt_hash, params_hash)`.

## Reguli de design

- **5 tool-uri umbrela.** Adaugarea unui model NOU = un rand in `MODEL_REGISTRY`, nu un tool nou.
- **`model` e mereu enum-discriminator.** Tool-ul rejecteaza la validare daca modelul nu e registrat.
- **`wait` e opt-out, nu opt-in.** Default `wait: true` pentru ca asta e diferentiatorul. User cere explicit `wait: false` daca vrea async.
- **Cost vizibil dupa fiecare call.** Tool-ul returneaza `cost_usd` in payload.
- **Concurrency cap pentru `kie_compare`:** 4 paralel max.

## Eval gate

Fiecare faza inchisa cere o lista de assert-uri eval green:

| Faza | Eval | Verifica |
|------|------|----------|
| 0 | `phase0_scaffold.eval.ts` | Server porneste, raspunde `tools/list` cu cel putin tool-urile utility |
| 1 | `phase1_client.eval.ts` | KieClient serializeaza request corect, retry-uieste pe 5xx, fail explicit pe 4xx |
| 2 | `phase2_tools.eval.ts` | Cele 5 tool-uri umbrela apar in `tools/list`, dispatcher rejecteaza model necunoscut |
| 3 | `phase3_wait_download.eval.ts` | Polling termina, asset apare pe disk, idempotency hit returneaza acelasi task |
| 4 | `phase4_telemetry_compare.eval.ts` | Cost report sumeaza correct, `kie_compare` ruleaza N paralel cu cap 4 |
| 5 | `phase5_live_smoke.eval.ts` (gated `KIE_EVAL_LIVE=1`) | Apel real kie.ai cu cheia din env, asset descarcat, cost logged |

`npm run eval` ruleaza tot ce e mock-uit. `npm run eval:live` adauga smoke real.

## Convention pentru adaugarea unui model nou

1. Adauga intrare in `src/registry.ts` (`MODEL_REGISTRY`) cu: id, kind (image/video/...), endpoint, cost_estimator, param schema.
2. Adauga fixture in `tests/fixtures/<model>.json` (mock raspuns kie.ai).
3. Adauga linie in `evals/phase2_tools.eval.ts` care verifica dispatch corect.
4. NU adauga un tool MCP nou; nu adauga o metoda noua in `KieClient` decat daca endpoint-ul e fundamental diferit.

## Commit hygiene

- Un commit per faza, mesaj `phaseN: <summary>`.
- `npm run typecheck && npm run eval` trebuie sa fie green inainte de commit.
- Live smoke (`eval:live`) opt-in, ruleaza local inainte de release.

## Anti-contamination

Codul a fost scris fara referinta la alte implementari MCP kie.ai. Endpoint-uri si parametri provin din `https://docs.kie.ai` (public API doc, fapte de API, nu IP al tertilor). Daca observi vreo descriere de tool, nume de variabila sau structura care suspect seamana cu un proiect existent, refactorizeaza si ridica issue.
