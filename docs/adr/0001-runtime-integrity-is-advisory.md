---
status: accepted
---

# Keep runtime integrity checks advisory

JNbot allows unsigned and modified plugins and profile scripts to run so the provenance rollout does not break existing installations. Import and marketplace entry points warn and ask for confirmation when supplied verification fails, but execution paths only report integrity status and never refuse content that the user already accepted. Acceptance applies to one exact content digest and does not trust later versions or the claimed publisher. Removing publisher trust leaves already accepted revisions runnable but requires confirmation for future content.
