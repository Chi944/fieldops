# FieldOps AI configuration evidence

Checked 13 September 2026 through the authenticated Groq console. The Personal organization shows **Free — Current Plan — $0**. A new project named **FieldOps**, `project_01m2brhpxpejmbgr4xn70c8yx1`, was created. Existing project keys were not reused.

**Inference APIs ZDR** was enabled and the saved switch was verified. This is the organization's inference retention setting, which covers the chat-completions endpoint used by FieldOps. Global ZDR remains off; batch and fine-tuning settings were not changed. FieldOps does not use those APIs. Groq still retains usage metadata, as described in its [data-handling documentation](https://console.groq.com/docs/your-data).

A dedicated **FieldOps development** key expires on **12 December 2026** and is stored only in the gitignored `.env.ai.local`. The allowed model is `openai/gpt-oss-120b`, which supports strict structured outputs according to the [official documentation](https://console.groq.com/docs/structured-outputs). No upgrade, payment method or paid fallback was configured.

The personal launcher accepts `--ai`, validates the dedicated key/settings without printing them, and keeps database, authentication and file storage local. Its synthetic-workspace startup passed on `127.0.0.1:3003` with `canExtract: true`. Readiness alone does not establish extraction accuracy; actual provider results belong in the measured evaluation report. The existing personal session on port 3001 remains parser-only.

Vercel and Trigger Production have not received this development key. Hosted Auth, private storage and production processing now work in parser-only mode. Hosted AI stays disabled because multi-item extraction reliability has not passed acceptance. Rotate the key before expiry and recheck the Free Plan and inference ZDR after account changes.

## Actual application smoke

Two self-authored one-item quotations completed real extraction in the isolated local AI workspace. Atlas used 2,453 input and 1,912 output tokens in 4,832 ms; Beacon used 1,953 input and 1,713 output tokens in 3,850 ms. These are successful-attempt measurements, excluding earlier rejected attempts and quota waiting. The application recorded zero monetary cost on the Free path; this is not a complete provider billing statement.

The buyer correction from USD 1.10 to 1.05 survived the other file's retry. Its original interpretation and the resulting USD 0.10 line-amount discrepancy remained visible. A real AI matching request proposed one source-linked equivalent group; the buyer approved it. The matrix showed USD 2.50 versus 2.10 while withholding an overall winner. The downloaded revision-7 workbook reopened with 13 worksheets, original and corrected values, source references and the discrepancy. Matching token usage was not captured by this application snapshot.

This proves a small connected AI workflow, not broad quotation accuracy. A selected development PDF still failed its final chunk after two accepted chunks and one explicit retry; the validated chunks were reused, and no partial quotation was accepted. The untouched held-out split remains unrun. See the [measured evaluation](evaluation-report.md) for rejected-output counts, unavailable usage and reproducibility limits.
