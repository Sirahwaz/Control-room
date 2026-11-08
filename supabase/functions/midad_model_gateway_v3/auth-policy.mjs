export function resolveModelGatewayAuthMode({
  ingestHeader = "",
  ingestSecret = "",
  autonomyHeader = "",
  autonomySecret = ""
} = {}) {
  if (autonomyHeader && autonomySecret && autonomyHeader === autonomySecret) return "autonomy";
  if (ingestHeader && ingestSecret && ingestHeader === ingestSecret) return "ingest";
  return "unauthorized";
}
