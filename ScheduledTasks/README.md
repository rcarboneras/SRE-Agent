# Scheduled Tasks

This folder contains exported definitions of scheduled tasks used by [Azure SRE Agent](https://sre.azure.com).

Since SRE Agent does not currently provide a native export/import feature for scheduled tasks, these JSON files serve as **configuration-as-code** — version-controlled, portable definitions that can be used to recreate tasks on any SRE Agent instance.

## File Format

Each `.json` file represents a single scheduled task with the following fields:

| Field | Type | Description |
|---|---|---|
| `name` | string | Task name (≤60 chars) |
| `description` | string | Short description of the task's purpose |
| `cronExpression` | string | Standard 5-part cron (`minute hour day month day-of-week`) |
| `durationHours` | int/null | Auto-stop window in hours (`null` = indefinite) |
| `maxExecutions` | int/null | Execution cap (`null` = unlimited) |
| `useCurrentThread` | bool | `true` = shared thread context; `false` = isolated per run |
| `agentPrompt` | string | Full autonomous execution instructions for the agent |

## How to Recreate a Task in a New SRE Agent

1. Open a conversation with the target SRE Agent.
2. Open the `.json` file for the task you want to create.
3. Ask the agent to create the task, providing all the parameters. Example:

   > Create a scheduled task with these parameters:
   > - **Name**: `<name>`
   > - **Description**: `<description>`
   > - **Cron**: `<cronExpression>`
   > - **Prompt**: `<agentPrompt>`
   > - **Duration**: `<durationHours>`
   > - **Max Executions**: `<maxExecutions>`
   > - **Use Current Thread**: `<useCurrentThread>`

4. **Important**: Update any subscription IDs, resource groups, or resource-specific references in the `agentPrompt` to match the target agent's scope.

## Cron Expression Reference

| Expression | Frequency |
|---|---|
| `0 9 * * *` | Daily at 09:00 UTC |
| `*/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour |
| `0 9 * * 1-5` | Weekdays at 09:00 UTC |
| `0 0 * * 0` | Weekly on Sunday at midnight |

## Tasks

| File | Schedule | Description |
|---|---|---|
| [InformeDiarioActualizaciones.json](InformeDiarioActualizaciones.json) | Daily 09:00 UTC | PDF report with Azure VM and Arc machine update/patch status |
