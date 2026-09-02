// Clés partagées entre app/index.tsx, app/onboarding.tsx et app/signup.tsx —
// un seul endroit pour ne jamais désynchroniser lecture/écriture (même
// discipline que la clé de token décrite dans src/utils/storage/index.ts).
export const ONBOARDING_COMPLETED_KEY = 'levanea_onboarding_completed';
export const SIGNUP_DRAFT_KEY = 'levanea_signup_draft';
