export const stages = ['New','Contacted','Interested','Converted','Rejected'] as const;
export type Stage = typeof stages[number];
export type Role = 'Owner'|'Admin'|'Agent';
export interface Identity { userId:string; workspaceId:string; role:Role; email:string; name:string; workspaceName:string; csrf:string }
export interface LeadRecord { id:string; workspace_id:string; lead_id:string; form_id:string; page_id:string; name:string; email:string; phone:string; campaign:string; ad_id:string|null; submitted_at:string; status:Stage; assigned_to:string|null; created_at:string; updated_at:string; form_name:string; page_name:string; source:string }
export interface FormRecord { id:string; name:string; page_id:string; page_name:string; status:string; selected:number; lead_count:number; questions_json:string; last_sync_at:string|null }
export interface Note { id:string; body:string; created_at:string; author_name:string }
export interface ActivityRecord { id:string; kind:string; detail:string; created_at:string; actor_name:string|null }
export interface TaskRecord { id:string; lead_id:string|null; title:string; due_at:string; priority:'Low'|'Normal'|'High'; completed_at:string|null; assigned_to:string|null; lead_name:string|null; assignee_name:string|null }
export interface LeadDetail { lead:LeadRecord; answers:{field_key:string; question:string; values_json:string}[]; notes:Note[]; activities:ActivityRecord[]; tasks:TaskRecord[]; possible_duplicates:{id:string; name:string; submitted_at:string}[] }
export interface ListResult<T> { items:T[]; total:number; page:number; pageSize:number }
export interface Analytics { total:number; counts:Record<Stage,number>; conversionRate:number; followupsDue:number; days:{day:string; total:number}[]; forms:{name:string; total:number; converted:number}[]; campaigns:{name:string; total:number}[]; agents:{name:string; total:number; converted:number}[]; timezone:'UTC'; from:string; to:string }
