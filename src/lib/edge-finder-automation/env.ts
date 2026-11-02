import { config } from "@/lib/config";

function trim(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export function edgeFinderAutomationEnabled(): boolean {
  return trim("DROPFLOW_EDGE_FINDER_AUTOMATION_ENABLED").toLowerCase() === "true";
}

export function edgeFinderAutomationSecret(): string {
  return trim("DROPFLOW_EDGE_FINDER_AUTOMATION_SECRET") || trim("DROPFLOW_AUTOMATION_SECRET");
}

export function edgeFinderStateMachineArn(): string {
  return trim("DROPFLOW_EDGE_FINDER_STATE_MACHINE_ARN");
}

export function edgeFinderAutomationAdminUserId(): string {
  return trim("DROPFLOW_AUTOMATION_ADMIN_USER_ID");
}

export function edgeFinderAutomationConfigured(): boolean {
  return Boolean(
    edgeFinderAutomationEnabled() &&
      edgeFinderAutomationSecret() &&
      edgeFinderAutomationAdminUserId() &&
      edgeFinderStateMachineArn()
  );
}

export function edgeFinderAutomationAdminEmail(): string {
  return config.admin.adminEmail || "admin@dropflow.us";
}
