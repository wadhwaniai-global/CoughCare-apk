# UI text rules

Rules for any user-facing string in the app (alerts, labels, buttons, notices,
toasts, placeholders, status lines, error messages).

1. **Never use an em dash (—).** Permanent rule (2026-09-04). Use a period,
   a comma, a colon, or a second sentence instead.

   Before committing UI changes, check:

   ```bash
   grep -rn "—" src/ --include="*.ts" --include="*.tsx" | grep -vE ":\s*(//|\*|/\*)"
   ```

   Code comments may use whatever punctuation they like; the rule is about
   what collectors see on screen.

2. Field-facing wording should be plain and directive ("Update any paper
   forms that carry the old ID"), not technical. Status codes may appear
   only when a support conversation needs them (e.g. "(409)").
