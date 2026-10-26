import { Settings2 } from "lucide-react";
import { cell, ResultsTable } from "@/components/admin/results-table";
import { SettingDialog } from "@/components/admin/setting-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Section } from "@/components/layout/section";
import { listEditableSettings } from "@/lib/dal/plan-editor";
import { releaseWarning, ruleText, settingValueText, type SettingRule } from "@/lib/validation/plan-editor";

function SettingsTable({ caption, rules, release }: { caption: string; rules: readonly SettingRule[]; release?: boolean }) {
  return (
    <ResultsTable caption={caption} columns={release ? ["Release", "State", "Legal documents", "Actions"] : ["Setting", "Value", "Rule", "Actions"]}>
      {rules.map((rule) => {
        const gaps = releaseWarning(rule, "true");
        return (
          <tr key={rule.key}>
            <td className={`${cell} break-words`}>
              <span className="block font-medium">{rule.label}</span>
              <span className="block text-small text-muted-foreground break-all">{rule.key}</span>
            </td>
            <td className={`${cell} break-all`}>
              {release ? (
                <StatusBadge status={rule.value === "true" ? "success" : "neutral"}>{rule.value === "true" ? "Live" : "Off"}</StatusBadge>
              ) : (
                settingValueText(rule, rule.value)
              )}
            </td>
            <td className={`${cell} break-words`}>
              {release ? (gaps.length > 0 ? `${gaps.length} not approved: ${gaps.join("; ")}` : "All approved") : ruleText(rule)}
            </td>
            <td className={cell}>
              <SettingDialog rule={rule} />
            </td>
          </tr>
        );
      })}
    </ResultsTable>
  );
}

// The settings an administrator may change (FR-R2 AC7, NFR-O5); everything else is changed by a reviewed migration.
export async function SettingsList() {
  const rules = await listEditableSettings();
  if (rules.length === 0) return <EmptyState icon={Settings2} title="No settings can be changed here" />;
  const releases = rules.filter((rule) => rule.releaseFeature !== null);
  const others = rules.filter((rule) => rule.releaseFeature === null);

  return (
    <div className="grid gap-page">
      {releases.length > 0 ? (
        <Section
          id="releases"
          title="Releases"
          description="Switching a release on puts its pages live for everyone at once. It can be switched on only once every legal document of the release is approved; switching it off is always possible."
        >
          <SettingsTable caption="Release switches" rules={releases} release />
        </Section>
      ) : null}
      <Section id="settings" title="Settings">
        <SettingsTable caption="Platform settings" rules={others} />
      </Section>
    </div>
  );
}
