# FieldOps AI configuration evidence

Checked 13 September 2026 through the authenticated Groq console. The Personal organization shows **Free — Current Plan — $0**. A new project named **FieldOps**, `project_01m2brhpxpejmbgr4xn70c8yx1`, was created. Existing project keys were not reused.

**Inference APIs ZDR** was enabled and the saved switch was verified. This is the organization's inference retention setting, which covers the chat-completions endpoint used by FieldOps. Global ZDR remains off; batch and fine-tuning settings were not changed. FieldOps does not use those APIs. Groq still retains usage metadata, as described in its [data-handling documentation](https://console.groq.com/docs/your-data).

A dedicated **FieldOps development** key expires on **12 December 2026** and is stored only in the gitignored `.env.ai.local`. The allowed model is `openai/gpt-oss-120b`, which supports strict structured outputs according to the [official documentation](https://console.groq.com/docs/structured-outputs). No upgrade, payment method or paid fallback was configured.

The personal launcher accepts `--ai`, validates the dedicated key/settings without printing them, and keeps database, authentication and file storage local. Its synthetic-workspace startup passed on `127.0.0.1:3003` with `canExtract: true`. Readiness alone does not establish extraction accuracy; actual provider results belong in the measured evaluation report. The existing personal session on port 3001 remains parser-only.

Vercel and Trigger Production have not received this development key. Hosted AI remains unavailable until private Auth/storage and production worker configuration are complete. Rotate the key before expiry and recheck the Free Plan and inference ZDR after account changes.
