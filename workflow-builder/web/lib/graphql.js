import { gql } from '@apollo/client';

export const MY_ORG_MEMBERSHIPS = gql`
  query MyOrgMemberships($userId: uuid!) {
    org_members(where: { user_id: { _eq: $userId } }) {
      id
      role
      organization {
        id
        name
        quota_used
        quota_limit
      }
    }
  }
`;

export const ORG_STATS = gql`
  query OrgStats($orgId: uuid!) {
    org_stats(where: { org_id: { _eq: $orgId } }) {
      org_id
      quota_used
      quota_limit
      runs_this_month
      avg_run_duration_seconds
    }
  }
`;

export const ORG_WORKFLOWS = gql`
  query OrgWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { created_at: desc }) {
      id
      name
      description
      created_at
      workflow_steps(order_by: { step_order: asc }) {
        id
        type
        step_order
      }
      workflow_triggers {
        id
        type
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        trigger_type
        started_at
      }
    }
  }
`;

export const WORKFLOW_DETAIL = gql`
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      org_id
      workflow_steps(order_by: { step_order: asc }) {
        id
        type
        config
        step_order
      }
      workflow_triggers {
        id
        type
        config
      }
      workflow_runs(order_by: { started_at: desc }, limit: 15) {
        id
        status
        trigger_type
        started_at
        finished_at
        error
      }
    }
  }
`;

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String, $createdBy: uuid!) {
    insert_workflows_one(
      object: { org_id: $orgId, name: $name, description: $description, created_by: $createdBy }
    ) {
      id
    }
  }
`;

export const ADD_STEP = gql`
  mutation AddStep($workflowId: uuid!, $stepOrder: Int!, $type: String!, $config: jsonb!) {
    insert_workflow_steps_one(
      object: { workflow_id: $workflowId, step_order: $stepOrder, type: $type, config: $config }
    ) {
      id
    }
  }
`;

export const ADD_TRIGGER = gql`
  mutation AddTrigger($workflowId: uuid!, $type: String!, $config: jsonb!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflowId, type: $type, config: $config }) {
      id
    }
  }
`;

export const TRIGGER_WORKFLOW_RUN = gql`
  mutation TriggerWorkflowRun($workflowId: uuid!, $initialInput: json) {
    triggerWorkflowRun(workflow_id: $workflowId, initial_input: $initialInput) {
      run_id
      status
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!, $approve: Boolean) {
    approveStep(step_run_id: $stepRunId, approve: $approve) {
      run_id
      status
    }
  }
`;

export const SIMULATE_EVENT = gql`
  mutation SimulateEvent($workflowId: uuid!, $payload: jsonb!) {
    insert_workflow_trigger_events_one(object: { workflow_id: $workflowId, payload: $payload }) {
      id
    }
  }
`;

export const WORKFLOW_RUN_STATUS_SUB = gql`
  subscription WorkflowRunStatus($runId: uuid!) {
    workflow_runs_by_pk(id: $runId) {
      id
      status
      error
      trigger_type
      started_at
      finished_at
    }
  }
`;

export const STEP_RUNS_SUB = gql`
  subscription StepRunsForRun($runId: uuid!) {
    step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { started_at: asc }) {
      id
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      finished_at
      workflow_step {
        type
        step_order
        config
      }
    }
  }
`;
