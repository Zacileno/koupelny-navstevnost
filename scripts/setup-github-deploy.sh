#!/usr/bin/env bash
# Jednorázové nastavení automatického deploye z GitHubu (.github/workflows/deploy.yml).
#
# Založí v GCP:
#   - Workload Identity Pool + OIDC provider pro GitHub, omezený na repozitář
#     Zacileno/koupelny-navstevnost a větev main (jiný repo/větev se nepřihlásí)
#   - service account github-deployer jen s rolemi potřebnými pro deploy
#     hosting + functions (žádný Editor/Owner, žádný klíč)
# a nastaví v GitHub repozitáři dvě proměnné (ne secrets — nejsou tajné).
#
# Spouští člověk ve svém terminálu, ne agent:
#   gcloud auth login
#   bash scripts/setup-github-deploy.sh
#
# Idempotentní — opakované spuštění jen přeskočí, co už existuje.

set -euo pipefail

PROJECT_ID="koupelny-navstevnost"
REPO="Zacileno/koupelny-navstevnost"
POOL="github"
PROVIDER="github-actions"
SA_NAME="github-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "Projekt $PROJECT_ID ($PROJECT_NUMBER)"

# Čerstvě založený service account IAM chvíli "nevidí" (eventual consistency,
# "Service account ... does not exist") — zkoušet znovu, než to vzdát.
retry() {
  local n
  for n in 1 2 3 4 5 6 7 8 9 10; do
    "$@" && return 0
    echo "   …ještě se nepropsalo, zkouším znovu za 10 s ($n/10)"
    sleep 10
  done
  return 1
}

echo "→ API"
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project "$PROJECT_ID"

echo "→ Service account $SA_EMAIL"
gcloud iam service-accounts describe "$SA_EMAIL" --project "$PROJECT_ID" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT_ID" \
       --display-name "GitHub Actions deploy (hosting + functions)"

echo "→ Role pro deploy"
for role in \
  roles/firebasehosting.admin \
  roles/cloudfunctions.admin \
  roles/run.viewer \
  roles/artifactregistry.reader \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebase.viewer \
  roles/firebaseextensions.viewer; do
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member "serviceAccount:$SA_EMAIL" --role "$role" --condition=None --quiet >/dev/null
  echo "   $role"
done

# Functions běží pod default Compute SA — deployer ho musí smět "použít",
# ale jen tenhle jeden účet, ne všechny v projektu.
retry gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" --project "$PROJECT_ID" \
  --member "serviceAccount:$SA_EMAIL" --role roles/iam.serviceAccountUser --quiet >/dev/null
echo "   roles/iam.serviceAccountUser jen na $RUNTIME_SA"

echo "→ Workload Identity Pool + provider"
gcloud iam workload-identity-pools describe "$POOL" --project "$PROJECT_ID" --location global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create "$POOL" --project "$PROJECT_ID" --location global \
       --display-name "GitHub Actions"

gcloud iam workload-identity-pools providers describe "$PROVIDER" --project "$PROJECT_ID" \
  --location global --workload-identity-pool "$POOL" >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" --project "$PROJECT_ID" \
       --location global --workload-identity-pool "$POOL" \
       --display-name "GitHub Actions" \
       --issuer-uri "https://token.actions.githubusercontent.com" \
       --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
       --attribute-condition "assertion.repository == '${REPO}' && assertion.ref == 'refs/heads/main'"

echo "→ Povolit repozitáři vystupovat jako $SA_NAME"
retry gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" --project "$PROJECT_ID" \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${REPO}" \
  --quiet >/dev/null

PROVIDER_NAME="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"

echo "→ Proměnné v GitHub repozitáři"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --repo "$REPO" --body "$PROVIDER_NAME"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --repo "$REPO" --body "$SA_EMAIL"

echo
echo "✔ Hotovo. Provider: $PROVIDER_NAME"
echo "  Service account: $SA_EMAIL"
