
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "appeals": {
                  Row: {
                    "appellant_user_id": string | null,"decided_at": string | null,"decided_by": string | null,"due_at": string,"grounds": string,"id": number,"lodged_at": string,"moderation_action_id": number,"organization_id": string,"reasons": string | null,"reversal_action_id": number | null,"status": Database["public"]['Enums']["appeal_status"]
                  }
                  Insert: {
                    "appellant_user_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"due_at": string,"grounds": string,"id"?: never,"lodged_at"?: string,"moderation_action_id": number,"organization_id": string,"reasons"?: string | null,"reversal_action_id"?: number | null,"status"?: Database["public"]['Enums']["appeal_status"]
                  }
                  Update: {
                    "appellant_user_id"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"due_at"?: string,"grounds"?: string,"id"?: never,"lodged_at"?: string,"moderation_action_id"?: number,"organization_id"?: string,"reasons"?: string | null,"reversal_action_id"?: number | null,"status"?: Database["public"]['Enums']["appeal_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "appeals_appellant_user_id_fkey"
      columns: ["appellant_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appeals_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appeals_moderation_action_id_fkey"
      columns: ["moderation_action_id"]
isOneToOne: true
      referencedRelation: "moderation_actions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appeals_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "appeals_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "appeals_reversal_action_id_fkey"
      columns: ["reversal_action_id"]
isOneToOne: false
      referencedRelation: "moderation_actions"
      referencedColumns: ["id"]
    }
                  ]
                },"application_events": {
                  Row: {
                    "actor_id": string | null,"application_id": string,"created_at": string,"from_status": Database["public"]['Enums']["application_status"] | null,"id": number,"note": string | null,"to_status": Database["public"]['Enums']["application_status"]
                  }
                  Insert: {
                    "actor_id"?: string | null,"application_id": string,"created_at"?: string,"from_status"?: Database["public"]['Enums']["application_status"] | null,"id"?: never,"note"?: string | null,"to_status": Database["public"]['Enums']["application_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"application_id"?: string,"created_at"?: string,"from_status"?: Database["public"]['Enums']["application_status"] | null,"id"?: never,"note"?: string | null,"to_status"?: Database["public"]['Enums']["application_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_events_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "job_applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "application_events_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "v_job_applicants"
      referencedColumns: ["id"]
    }
                  ]
                },"application_notes": {
                  Row: {
                    "application_id": string,"author_id": string,"body": string,"created_at": string,"id": number,"organization_id": string
                  }
                  Insert: {
                    "application_id": string,"author_id"?: string,"body": string,"created_at"?: string,"id"?: never,"organization_id": string
                  }
                  Update: {
                    "application_id"?: string,"author_id"?: string,"body"?: string,"created_at"?: string,"id"?: never,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_notes_application_id_organization_id_fkey"
      columns: ["application_id","organization_id"]
isOneToOne: false
      referencedRelation: "job_applications"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "application_notes_application_id_organization_id_fkey"
      columns: ["application_id","organization_id"]
isOneToOne: false
      referencedRelation: "v_job_applicants"
      referencedColumns: ["id","organization_id"]
    },{
      foreignKeyName: "application_notes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "application_notes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"candidate_submissions": {
                  Row: {
                    "created_at": string,"decided_at": string | null,"employer_organization_id": string,"id": string,"invitation_emailed_at": string | null,"invited_email": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"note": string | null,"organization_id": string,"passport_share_id": string | null,"profile_snapshot": Json | null,"requirement_id": string,"response_id": string | null,"status": Database["public"]['Enums']["submission_status"],"submitted_by": string | null,"updated_at": string,"withdrawn_at": string | null,"worker_approved_at": string | null,"worker_user_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"decided_at"?: string | null,"employer_organization_id": string,"id"?: string,"invitation_emailed_at"?: string | null,"invited_email": string,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"note"?: string | null,"organization_id": string,"passport_share_id"?: string | null,"profile_snapshot"?: Json | null,"requirement_id": string,"response_id"?: string | null,"status"?: Database["public"]['Enums']["submission_status"],"submitted_by"?: string | null,"updated_at"?: string,"withdrawn_at"?: string | null,"worker_approved_at"?: string | null,"worker_user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"decided_at"?: string | null,"employer_organization_id"?: string,"id"?: string,"invitation_emailed_at"?: string | null,"invited_email"?: string,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"note"?: string | null,"organization_id"?: string,"passport_share_id"?: string | null,"profile_snapshot"?: Json | null,"requirement_id"?: string,"response_id"?: string | null,"status"?: Database["public"]['Enums']["submission_status"],"submitted_by"?: string | null,"updated_at"?: string,"withdrawn_at"?: string | null,"worker_approved_at"?: string | null,"worker_user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "candidate_submissions_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "candidate_submissions_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "candidate_submissions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "candidate_submissions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "candidate_submissions_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "candidate_submissions_response_id_fkey"
      columns: ["response_id"]
isOneToOne: false
      referencedRelation: "partner_responses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "candidate_submissions_submitted_by_fkey"
      columns: ["submitted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"cities": {
                  Row: {
                    "country_code": string,"id": number,"name": string,"population": number
                  }
                  Insert: {
                    "country_code": string,"id": number,"name": string,"population"?: number
                  }
                  Update: {
                    "country_code"?: string,"id"?: number,"name"?: string,"population"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cities_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    }
                  ]
                },"consents": {
                  Row: {
                    "action": Database["public"]['Enums']["consent_action"],"created_at": string,"id": number,"purpose": string,"user_id": string,"version": number
                  }
                  Insert: {
                    "action": Database["public"]['Enums']["consent_action"],"created_at"?: string,"id"?: never,"purpose": string,"user_id": string,"version": number
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["consent_action"],"created_at"?: string,"id"?: never,"purpose"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"countries": {
                  Row: {
                    "code": string,"name": string
                  }
                  Insert: {
                    "code": string,"name": string
                  }
                  Update: {
                    "code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"currencies": {
                  Row: {
                    "code": string,"name": string
                  }
                  Insert: {
                    "code": string,"name": string
                  }
                  Update: {
                    "code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"data_export_requests": {
                  Row: {
                    "expires_at": string | null,"files_left_out": number | null,"id": string,"ready_at": string | null,"requested_at": string,"size_bytes": number | null,"status": Database["public"]['Enums']["data_export_status"],"storage_path": string | null,"user_id": string
                  }
                  Insert: {
                    "expires_at"?: string | null,"files_left_out"?: number | null,"id"?: string,"ready_at"?: string | null,"requested_at"?: string,"size_bytes"?: number | null,"status"?: Database["public"]['Enums']["data_export_status"],"storage_path"?: string | null,"user_id": string
                  }
                  Update: {
                    "expires_at"?: string | null,"files_left_out"?: number | null,"id"?: string,"ready_at"?: string | null,"requested_at"?: string,"size_bytes"?: number | null,"status"?: Database["public"]['Enums']["data_export_status"],"storage_path"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "data_export_requests_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"direct_hiring_rules": {
                  Row: {
                    "created_at": string,"destination_country": string | null,"id": string,"legal_opinion_ref": string,"notice": string,"rule": Database["public"]['Enums']["direct_hiring_rule_value"],"source_country": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "created_at"?: string,"destination_country"?: string | null,"id"?: string,"legal_opinion_ref": string,"notice": string,"rule": Database["public"]['Enums']["direct_hiring_rule_value"],"source_country": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"destination_country"?: string | null,"id"?: string,"legal_opinion_ref"?: string,"notice"?: string,"rule"?: Database["public"]['Enums']["direct_hiring_rule_value"],"source_country"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "direct_hiring_rules_destination_country_fkey"
      columns: ["destination_country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "direct_hiring_rules_source_country_fkey"
      columns: ["source_country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "direct_hiring_rules_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"follows": {
                  Row: {
                    "created_at": string,"last_digest_at": string | null,"organization_id": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"last_digest_at"?: string | null,"organization_id": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"last_digest_at"?: string | null,"organization_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "follows_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "follows_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "follows_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"industries": {
                  Row: {
                    "code": string,"name": string
                  }
                  Insert: {
                    "code": string,"name": string
                  }
                  Update: {
                    "code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"job_applications": {
                  Row: {
                    "cover_note": string | null,"created_at": string,"id": string,"job_id": string,"organization_id": string,"passport_share_id": string,"profile_snapshot": NonNullable<Json>,"status": Database["public"]['Enums']["application_status"],"worker_user_id": string
                  }
                  Insert: {
                    "cover_note"?: string | null,"created_at"?: string,"id"?: string,"job_id": string,"organization_id": string,"passport_share_id": string,"profile_snapshot": NonNullable<Json>,"status"?: Database["public"]['Enums']["application_status"],"worker_user_id": string
                  }
                  Update: {
                    "cover_note"?: string | null,"created_at"?: string,"id"?: string,"job_id"?: string,"organization_id"?: string,"passport_share_id"?: string,"profile_snapshot"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["application_status"],"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "job_applications_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_applications_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_applications_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "accommodation": boolean,"city": string,"country_code": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"description": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"industry_code": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"occupation_id": string,"organization_id": string,"posted_on_behalf_of_organization_id": string | null,"published_at": string | null,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"requirement_id": string | null,"salary_currency": string | null,"salary_max": number | null,"salary_min": number | null,"salary_period": Database["public"]['Enums']["salary_period"] | null,"search_vector": unknown,"status": Database["public"]['Enums']["job_status"],"status_changed_at": string,"title": string,"updated_at": string,"visa_support": boolean
                  }
                  Insert: {
                    "accommodation"?: boolean,"city": string,"country_code": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description": string,"employment_type": Database["public"]['Enums']["employment_type"],"id"?: string,"industry_code": string,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"occupation_id": string,"organization_id": string,"posted_on_behalf_of_organization_id"?: string | null,"published_at"?: string | null,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"requirement_id"?: string | null,"salary_currency"?: string | null,"salary_max"?: number | null,"salary_min"?: number | null,"salary_period"?: Database["public"]['Enums']["salary_period"] | null,"search_vector"?: never,"status"?: Database["public"]['Enums']["job_status"],"status_changed_at"?: string,"title": string,"updated_at"?: string,"visa_support"?: boolean
                  }
                  Update: {
                    "accommodation"?: boolean,"city"?: string,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description"?: string,"employment_type"?: Database["public"]['Enums']["employment_type"],"id"?: string,"industry_code"?: string,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"occupation_id"?: string,"organization_id"?: string,"posted_on_behalf_of_organization_id"?: string | null,"published_at"?: string | null,"recruitment_preference"?: Database["public"]['Enums']["recruitment_preference"],"requirement_id"?: string | null,"salary_currency"?: string | null,"salary_max"?: number | null,"salary_min"?: number | null,"salary_period"?: Database["public"]['Enums']["salary_period"] | null,"search_vector"?: never,"status"?: Database["public"]['Enums']["job_status"],"status_changed_at"?: string,"title"?: string,"updated_at"?: string,"visa_support"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "jobs_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_industry_code_fkey"
      columns: ["industry_code"]
isOneToOne: false
      referencedRelation: "industries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "jobs_occupation_id_fkey"
      columns: ["occupation_id"]
isOneToOne: false
      referencedRelation: "occupations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "jobs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "jobs_posted_on_behalf_of_organization_id_fkey"
      columns: ["posted_on_behalf_of_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_posted_on_behalf_of_organization_id_fkey"
      columns: ["posted_on_behalf_of_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "jobs_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_salary_currency_fkey"
      columns: ["salary_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                },"languages": {
                  Row: {
                    "code": string,"name": string
                  }
                  Insert: {
                    "code": string,"name": string
                  }
                  Update: {
                    "code"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"legal_documents": {
                  Row: {
                    "body": string,"change_summary": string,"is_draft": boolean,"published_at": string | null,"slug": string,"title": string,"version": number
                  }
                  Insert: {
                    "body": string,"change_summary": string,"is_draft"?: boolean,"published_at"?: string | null,"slug": string,"title": string,"version": number
                  }
                  Update: {
                    "body"?: string,"change_summary"?: string,"is_draft"?: boolean,"published_at"?: string | null,"slug"?: string,"title"?: string,"version"?: number
                  }
                  Relationships: [
                    
                  ]
                },"moderation_actions": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"id": number,"report_id": number | null,"statement_of_reasons": string,"target_id": string,"target_type": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"id"?: never,"report_id"?: number | null,"statement_of_reasons": string,"target_id": string,"target_type": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"id"?: never,"report_id"?: number | null,"statement_of_reasons"?: string,"target_id"?: string,"target_type"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notification_preferences": {
                  Row: {
                    "digest": boolean,"email_kinds": NonNullable<Json>,"email_undeliverable_at": string | null,"user_id": string
                  }
                  Insert: {
                    "digest"?: boolean,"email_kinds"?: NonNullable<Json>,"email_undeliverable_at"?: string | null,"user_id": string
                  }
                  Update: {
                    "digest"?: boolean,"email_kinds"?: NonNullable<Json>,"email_undeliverable_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"notifications": {
                  Row: {
                    "attempts": number,"created_at": string,"dedupe_key": string | null,"delivery": string | null,"email_status": string | null,"id": string,"kind": string,"last_error": string | null,"mandatory": boolean,"msg_id": number | null,"payload": NonNullable<Json>,"provider_message_id": string | null,"read_at": string | null,"sent_at": string | null,"status": string,"user_id": string | null
                  }
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"dedupe_key"?: string | null,"delivery"?: string | null,"email_status"?: string | null,"id"?: string,"kind": string,"last_error"?: string | null,"mandatory"?: boolean,"msg_id"?: number | null,"payload"?: NonNullable<Json>,"provider_message_id"?: string | null,"read_at"?: string | null,"sent_at"?: string | null,"status"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"dedupe_key"?: string | null,"delivery"?: string | null,"email_status"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"mandatory"?: boolean,"msg_id"?: number | null,"payload"?: NonNullable<Json>,"provider_message_id"?: string | null,"read_at"?: string | null,"sent_at"?: string | null,"status"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"occupations": {
                  Row: {
                    "code": string,"label": string,"synonyms": (string)[]
                  }
                  Insert: {
                    "code": string,"label": string,"synonyms"?: (string)[]
                  }
                  Update: {
                    "code"?: string,"label"?: string,"synonyms"?: (string)[]
                  }
                  Relationships: [
                    
                  ]
                },"organization_geographies": {
                  Row: {
                    "country_code": string,"created_at": string,"organization_id": string,"scope": Database["public"]['Enums']["geography_scope"]
                  }
                  Insert: {
                    "country_code": string,"created_at"?: string,"organization_id": string,"scope": Database["public"]['Enums']["geography_scope"]
                  }
                  Update: {
                    "country_code"?: string,"created_at"?: string,"organization_id"?: string,"scope"?: Database["public"]['Enums']["geography_scope"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_geographies_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "organization_geographies_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_geographies_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"organization_industries": {
                  Row: {
                    "created_at": string,"industry_code": string,"organization_id": string
                  }
                  Insert: {
                    "created_at"?: string,"industry_code": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"industry_code"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_industries_industry_code_fkey"
      columns: ["industry_code"]
isOneToOne: false
      referencedRelation: "industries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "organization_industries_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_industries_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"organization_invitations": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"organization_id": string,"role": Database["public"]['Enums']["member_role"],"token_hash": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"organization_id": string,"role": Database["public"]['Enums']["member_role"],"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"organization_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"organization_languages": {
                  Row: {
                    "created_at": string,"language_code": string,"organization_id": string
                  }
                  Insert: {
                    "created_at"?: string,"language_code": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"language_code"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_languages_language_code_fkey"
      columns: ["language_code"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "organization_languages_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_languages_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"organization_members": {
                  Row: {
                    "accepted_at": string | null,"invited_by": string | null,"organization_id": string,"role": Database["public"]['Enums']["member_role"],"user_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"invited_by"?: string | null,"organization_id": string,"role": Database["public"]['Enums']["member_role"],"user_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"invited_by"?: string | null,"organization_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_members_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_members_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "organization_members_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_occupations": {
                  Row: {
                    "created_at": string,"occupation_id": string,"organization_id": string
                  }
                  Insert: {
                    "created_at"?: string,"occupation_id": string,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"occupation_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_occupations_occupation_id_fkey"
      columns: ["occupation_id"]
isOneToOne: false
      referencedRelation: "occupations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "organization_occupations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_occupations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"organization_ownership_transfers": {
                  Row: {
                    "accepted_at": string | null,"cancelled_at": string | null,"created_at": string,"expires_at": string,"from_user_id": string,"id": string,"organization_id": string,"to_user_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"expires_at"?: string,"from_user_id": string,"id"?: string,"organization_id": string,"to_user_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"cancelled_at"?: string | null,"created_at"?: string,"expires_at"?: string,"from_user_id"?: string,"id"?: string,"organization_id"?: string,"to_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_ownership_transfers_from_user_id_fkey"
      columns: ["from_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_ownership_transfers_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_ownership_transfers_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "organization_ownership_transfers_to_user_id_fkey"
      columns: ["to_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"organization_service_types": {
                  Row: {
                    "created_at": string,"organization_id": string,"service": Database["public"]['Enums']["partner_service_type"]
                  }
                  Insert: {
                    "created_at"?: string,"organization_id": string,"service": Database["public"]['Enums']["partner_service_type"]
                  }
                  Update: {
                    "created_at"?: string,"organization_id"?: string,"service"?: Database["public"]['Enums']["partner_service_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "organization_service_types_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "organization_service_types_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "based_in_country": string,"created_at": string,"description": string | null,"display_name": string,"founded_year": number | null,"id": string,"industry_code": string | null,"info_step": string | null,"legal_entity_identifier": string | null,"legal_entity_identifier_kind": string | null,"legal_name": string,"listed_at": string | null,"moderation_state": Database["public"]['Enums']["job_moderation_state"] | null,"public_page_enabled": boolean,"recruitment_type": Database["public"]['Enums']["recruitment_preference"] | null,"review_status": Database["public"]['Enums']["partner_review_status"] | null,"slug": string,"status": Database["public"]['Enums']["organization_status"],"submitted_at": string | null,"type": Database["public"]['Enums']["organization_type"],"website": string | null,"workforce_profile_updated_at": string | null,"workforce_size_band": Database["public"]['Enums']["workforce_size_band"] | null
                  }
                  Insert: {
                    "based_in_country": string,"created_at"?: string,"description"?: string | null,"display_name": string,"founded_year"?: number | null,"id"?: string,"industry_code"?: string | null,"info_step"?: string | null,"legal_entity_identifier"?: string | null,"legal_entity_identifier_kind"?: string | null,"legal_name": string,"listed_at"?: string | null,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"] | null,"public_page_enabled"?: boolean,"recruitment_type"?: Database["public"]['Enums']["recruitment_preference"] | null,"review_status"?: Database["public"]['Enums']["partner_review_status"] | null,"slug": string,"status"?: Database["public"]['Enums']["organization_status"],"submitted_at"?: string | null,"type": Database["public"]['Enums']["organization_type"],"website"?: string | null,"workforce_profile_updated_at"?: string | null,"workforce_size_band"?: Database["public"]['Enums']["workforce_size_band"] | null
                  }
                  Update: {
                    "based_in_country"?: string,"created_at"?: string,"description"?: string | null,"display_name"?: string,"founded_year"?: number | null,"id"?: string,"industry_code"?: string | null,"info_step"?: string | null,"legal_entity_identifier"?: string | null,"legal_entity_identifier_kind"?: string | null,"legal_name"?: string,"listed_at"?: string | null,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"] | null,"public_page_enabled"?: boolean,"recruitment_type"?: Database["public"]['Enums']["recruitment_preference"] | null,"review_status"?: Database["public"]['Enums']["partner_review_status"] | null,"slug"?: string,"status"?: Database["public"]['Enums']["organization_status"],"submitted_at"?: string | null,"type"?: Database["public"]['Enums']["organization_type"],"website"?: string | null,"workforce_profile_updated_at"?: string | null,"workforce_size_band"?: Database["public"]['Enums']["workforce_size_band"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "organizations_based_in_country_fkey"
      columns: ["based_in_country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "organizations_industry_code_fkey"
      columns: ["industry_code"]
isOneToOne: false
      referencedRelation: "industries"
      referencedColumns: ["code"]
    }
                  ]
                },"partner_licences": {
                  Row: {
                    "confirmed_at": string,"country_code": string,"created_at": string,"created_by": string | null,"evidence_mime": string | null,"evidence_path": string | null,"evidence_requested_at": string | null,"evidence_scan_status": string | null,"evidence_size_bytes": number | null,"expiry_notified_on": string | null,"id": string,"issuing_authority": string,"licence_number": string,"organization_id": string,"partner_terms_version": number,"previous_evidence_mime": string | null,"previous_evidence_path": string | null,"previous_evidence_scan_status": string | null,"previous_evidence_size_bytes": number | null,"status": string,"updated_at": string,"valid_until": string
                  }
                  Insert: {
                    "confirmed_at": string,"country_code": string,"created_at"?: string,"created_by"?: string | null,"evidence_mime"?: string | null,"evidence_path"?: string | null,"evidence_requested_at"?: string | null,"evidence_scan_status"?: string | null,"evidence_size_bytes"?: number | null,"expiry_notified_on"?: string | null,"id"?: string,"issuing_authority": string,"licence_number": string,"organization_id": string,"partner_terms_version": number,"previous_evidence_mime"?: string | null,"previous_evidence_path"?: string | null,"previous_evidence_scan_status"?: string | null,"previous_evidence_size_bytes"?: number | null,"status"?: string,"updated_at"?: string,"valid_until": string
                  }
                  Update: {
                    "confirmed_at"?: string,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"evidence_mime"?: string | null,"evidence_path"?: string | null,"evidence_requested_at"?: string | null,"evidence_scan_status"?: string | null,"evidence_size_bytes"?: number | null,"expiry_notified_on"?: string | null,"id"?: string,"issuing_authority"?: string,"licence_number"?: string,"organization_id"?: string,"partner_terms_version"?: number,"previous_evidence_mime"?: string | null,"previous_evidence_path"?: string | null,"previous_evidence_scan_status"?: string | null,"previous_evidence_size_bytes"?: number | null,"status"?: string,"updated_at"?: string,"valid_until"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_licences_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "partner_licences_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_licences_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_licences_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"partner_response_documents": {
                  Row: {
                    "created_at": string,"employer_organization_id": string,"file_name": string,"id": string,"organization_id": string,"requirement_id": string,"response_id": string | null,"scan_status": string,"scanned_at": string | null,"size_bytes": number,"storage_path": string,"uploaded_by": string | null
                  }
                  Insert: {
                    "created_at"?: string,"employer_organization_id": string,"file_name": string,"id"?: string,"organization_id": string,"requirement_id": string,"response_id"?: string | null,"scan_status"?: string,"scanned_at"?: string | null,"size_bytes": number,"storage_path": string,"uploaded_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"employer_organization_id"?: string,"file_name"?: string,"id"?: string,"organization_id"?: string,"requirement_id"?: string,"response_id"?: string | null,"scan_status"?: string,"scanned_at"?: string | null,"size_bytes"?: number,"storage_path"?: string,"uploaded_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_response_documents_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_documents_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "partner_response_documents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_documents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "partner_response_documents_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_documents_response_id_fkey"
      columns: ["response_id"]
isOneToOne: false
      referencedRelation: "partner_responses"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_documents_uploaded_by_fkey"
      columns: ["uploaded_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_response_versions": {
                  Row: {
                    "changed_fields": (string)[],"created_at": string,"created_by": string | null,"employer_organization_id": string,"organization_id": string,"payload": NonNullable<Json>,"response_id": string,"version": number
                  }
                  Insert: {
                    "changed_fields": (string)[],"created_at"?: string,"created_by"?: string | null,"employer_organization_id": string,"organization_id": string,"payload": NonNullable<Json>,"response_id": string,"version": number
                  }
                  Update: {
                    "changed_fields"?: (string)[],"created_at"?: string,"created_by"?: string | null,"employer_organization_id"?: string,"organization_id"?: string,"payload"?: NonNullable<Json>,"response_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_response_versions_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_versions_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_versions_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "partner_response_versions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_response_versions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "partner_response_versions_response_id_fkey"
      columns: ["response_id"]
isOneToOne: false
      referencedRelation: "partner_responses"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_responses": {
                  Row: {
                    "available_from": string,"capacity": number,"created_at": string,"created_by": string | null,"decided_at": string | null,"decided_by": string | null,"decision_note": string | null,"employer_organization_id": string,"employer_seen_version": number,"experience_note": string,"fee_amount": number | null,"fee_currency": string | null,"fee_model": Database["public"]['Enums']["fee_model"],"id": string,"invitation_id": string | null,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"notes": string | null,"organization_id": string,"requirement_id": string,"status": Database["public"]['Enums']["response_status"],"submissions_allowed": boolean,"timeline_note": string | null,"updated_at": string,"version": number,"withdrawal_reason": string | null,"withdrawn_at": string | null
                  }
                  Insert: {
                    "available_from": string,"capacity": number,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"employer_organization_id": string,"employer_seen_version"?: number,"experience_note": string,"fee_amount"?: number | null,"fee_currency"?: string | null,"fee_model": Database["public"]['Enums']["fee_model"],"id"?: string,"invitation_id"?: string | null,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"notes"?: string | null,"organization_id": string,"requirement_id": string,"status"?: Database["public"]['Enums']["response_status"],"submissions_allowed"?: boolean,"timeline_note"?: string | null,"updated_at"?: string,"version"?: number,"withdrawal_reason"?: string | null,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "available_from"?: string,"capacity"?: number,"created_at"?: string,"created_by"?: string | null,"decided_at"?: string | null,"decided_by"?: string | null,"decision_note"?: string | null,"employer_organization_id"?: string,"employer_seen_version"?: number,"experience_note"?: string,"fee_amount"?: number | null,"fee_currency"?: string | null,"fee_model"?: Database["public"]['Enums']["fee_model"],"id"?: string,"invitation_id"?: string | null,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"notes"?: string | null,"organization_id"?: string,"requirement_id"?: string,"status"?: Database["public"]['Enums']["response_status"],"submissions_allowed"?: boolean,"timeline_note"?: string | null,"updated_at"?: string,"version"?: number,"withdrawal_reason"?: string | null,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_responses_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_responses_decided_by_fkey"
      columns: ["decided_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_responses_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_responses_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "partner_responses_fee_currency_fkey"
      columns: ["fee_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "partner_responses_invitation_id_fkey"
      columns: ["invitation_id"]
isOneToOne: false
      referencedRelation: "requirement_invitations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_responses_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_responses_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "partner_responses_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"partner_review_decisions": {
                  Row: {
                    "decided_at": string,"decided_by": string,"decision": string,"from_status": Database["public"]['Enums']["partner_review_status"],"id": number,"info_step": string | null,"organization_id": string,"reason": string,"submitted_at": string,"to_status": Database["public"]['Enums']["partner_review_status"]
                  }
                  Insert: {
                    "decided_at"?: string,"decided_by": string,"decision": string,"from_status": Database["public"]['Enums']["partner_review_status"],"id"?: never,"info_step"?: string | null,"organization_id": string,"reason": string,"submitted_at": string,"to_status": Database["public"]['Enums']["partner_review_status"]
                  }
                  Update: {
                    "decided_at"?: string,"decided_by"?: string,"decision"?: string,"from_status"?: Database["public"]['Enums']["partner_review_status"],"id"?: never,"info_step"?: string | null,"organization_id"?: string,"reason"?: string,"submitted_at"?: string,"to_status"?: Database["public"]['Enums']["partner_review_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "partner_review_decisions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "partner_review_decisions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"passport_shares": {
                  Row: {
                    "application_id": string | null,"consent_id": number,"created_at": string,"expires_at": string | null,"id": string,"organization_id": string,"revoked_at": string | null,"scope": NonNullable<Json>,"submission_id": string | null,"worker_user_id": string
                  }
                  Insert: {
                    "application_id"?: string | null,"consent_id": number,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"organization_id": string,"revoked_at"?: string | null,"scope": NonNullable<Json>,"submission_id"?: string | null,"worker_user_id": string
                  }
                  Update: {
                    "application_id"?: string | null,"consent_id"?: number,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"organization_id"?: string,"revoked_at"?: string | null,"scope"?: NonNullable<Json>,"submission_id"?: string | null,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "passport_shares_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "job_applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "passport_shares_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "v_job_applicants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "passport_shares_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "passport_shares_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "passport_shares_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "candidate_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"platform_staff": {
                  Row: {
                    "granted_at": string,"granted_by": string | null,"id": number,"revoked_at": string | null,"role": Database["public"]['Enums']["platform_role"],"user_id": string
                  }
                  Insert: {
                    "granted_at"?: string,"granted_by"?: string | null,"id"?: never,"revoked_at"?: string | null,"role": Database["public"]['Enums']["platform_role"],"user_id": string
                  }
                  Update: {
                    "granted_at"?: string,"granted_by"?: string | null,"id"?: never,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["platform_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "platform_staff_granted_by_fkey"
      columns: ["granted_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "platform_staff_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "account_kind": Database["public"]['Enums']["account_kind"] | null,"created_at": string,"deleted_at": string | null,"display_name": string | null,"id": string,"intended_account_kind": Database["public"]['Enums']["account_kind"] | null,"intended_organization_type": Database["public"]['Enums']["organization_type"] | null,"legal_hold": boolean,"pending_consents": NonNullable<Json>,"preferred_lang": string,"status": Database["public"]['Enums']["profile_status"]
                  }
                  Insert: {
                    "account_kind"?: Database["public"]['Enums']["account_kind"] | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id": string,"intended_account_kind"?: Database["public"]['Enums']["account_kind"] | null,"intended_organization_type"?: Database["public"]['Enums']["organization_type"] | null,"legal_hold"?: boolean,"pending_consents"?: NonNullable<Json>,"preferred_lang"?: string,"status"?: Database["public"]['Enums']["profile_status"]
                  }
                  Update: {
                    "account_kind"?: Database["public"]['Enums']["account_kind"] | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id"?: string,"intended_account_kind"?: Database["public"]['Enums']["account_kind"] | null,"intended_organization_type"?: Database["public"]['Enums']["organization_type"] | null,"legal_hold"?: boolean,"pending_consents"?: NonNullable<Json>,"preferred_lang"?: string,"status"?: Database["public"]['Enums']["profile_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_preferred_lang_fkey"
      columns: ["preferred_lang"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    }
                  ]
                },"reports": {
                  Row: {
                    "application_id": string | null,"candidate_submission_id": string | null,"category": Database["public"]['Enums']["report_category"],"content_path": string | null,"created_at": string,"decision_due_at": string,"details": string,"due_at": string,"good_faith_confirmed": boolean,"handled_at": string | null,"handled_by": string | null,"id": number,"job_id": string | null,"organization_id": string | null,"partner_response_id": string | null,"priority": number,"reporter_email": string | null,"reporter_user_id": string | null,"requirement_id": string | null,"resolution_note": string | null,"status": Database["public"]['Enums']["report_status"],"target_type": Database["public"]['Enums']["report_target_type"]
                  }
                  Insert: {
                    "application_id"?: string | null,"candidate_submission_id"?: string | null,"category": Database["public"]['Enums']["report_category"],"content_path"?: string | null,"created_at"?: string,"decision_due_at": string,"details": string,"due_at": string,"good_faith_confirmed": boolean,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: never,"job_id"?: string | null,"organization_id"?: string | null,"partner_response_id"?: string | null,"priority"?: never,"reporter_email"?: string | null,"reporter_user_id"?: string | null,"requirement_id"?: string | null,"resolution_note"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"target_type": Database["public"]['Enums']["report_target_type"]
                  }
                  Update: {
                    "application_id"?: string | null,"candidate_submission_id"?: string | null,"category"?: Database["public"]['Enums']["report_category"],"content_path"?: string | null,"created_at"?: string,"decision_due_at"?: string,"details"?: string,"due_at"?: string,"good_faith_confirmed"?: boolean,"handled_at"?: string | null,"handled_by"?: string | null,"id"?: never,"job_id"?: string | null,"organization_id"?: string | null,"partner_response_id"?: string | null,"priority"?: never,"reporter_email"?: string | null,"reporter_user_id"?: string | null,"requirement_id"?: string | null,"resolution_note"?: string | null,"status"?: Database["public"]['Enums']["report_status"],"target_type"?: Database["public"]['Enums']["report_target_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "reports_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "job_applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "v_job_applicants"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "reports_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"requirement_countries": {
                  Row: {
                    "country_code": string,"requirement_id": string
                  }
                  Insert: {
                    "country_code": string,"requirement_id": string
                  }
                  Update: {
                    "country_code"?: string,"requirement_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "requirement_countries_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "requirement_countries_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"requirement_invitations": {
                  Row: {
                    "answered_at": string | null,"decline_reason": string | null,"employer_organization_id": string,"expired_at": string | null,"id": string,"invited_at": string,"invited_by": string | null,"organization_id": string,"requirement_id": string,"responded_at": string | null,"source": string,"status": Database["public"]['Enums']["invitation_status"],"suggestion_criteria": (string)[] | null,"viewed_at": string | null,"withdrawn_at": string | null
                  }
                  Insert: {
                    "answered_at"?: string | null,"decline_reason"?: string | null,"employer_organization_id": string,"expired_at"?: string | null,"id"?: string,"invited_at"?: string,"invited_by"?: string | null,"organization_id": string,"requirement_id": string,"responded_at"?: string | null,"source": string,"status"?: Database["public"]['Enums']["invitation_status"],"suggestion_criteria"?: (string)[] | null,"viewed_at"?: string | null,"withdrawn_at"?: string | null
                  }
                  Update: {
                    "answered_at"?: string | null,"decline_reason"?: string | null,"employer_organization_id"?: string,"expired_at"?: string | null,"id"?: string,"invited_at"?: string,"invited_by"?: string | null,"organization_id"?: string,"requirement_id"?: string,"responded_at"?: string | null,"source"?: string,"status"?: Database["public"]['Enums']["invitation_status"],"suggestion_criteria"?: (string)[] | null,"viewed_at"?: string | null,"withdrawn_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "requirement_invitations_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirement_invitations_employer_organization_id_fkey"
      columns: ["employer_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "requirement_invitations_invited_by_fkey"
      columns: ["invited_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirement_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirement_invitations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "requirement_invitations_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"requirement_occupations": {
                  Row: {
                    "occupation_id": string,"quantity": number,"requirement_id": string
                  }
                  Insert: {
                    "occupation_id": string,"quantity": number,"requirement_id": string
                  }
                  Update: {
                    "occupation_id"?: string,"quantity"?: number,"requirement_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "requirement_occupations_occupation_id_fkey"
      columns: ["occupation_id"]
isOneToOne: false
      referencedRelation: "occupations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "requirement_occupations_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"requirement_versions": {
                  Row: {
                    "changed_by": string | null,"changed_fields": (string)[],"created_at": string,"new_values": NonNullable<Json>,"old_values": NonNullable<Json>,"organization_id": string,"requirement_id": string,"status": Database["public"]['Enums']["requirement_status"],"version": number
                  }
                  Insert: {
                    "changed_by"?: string | null,"changed_fields": (string)[],"created_at"?: string,"new_values": NonNullable<Json>,"old_values": NonNullable<Json>,"organization_id": string,"requirement_id": string,"status": Database["public"]['Enums']["requirement_status"],"version": number
                  }
                  Update: {
                    "changed_by"?: string | null,"changed_fields"?: (string)[],"created_at"?: string,"new_values"?: NonNullable<Json>,"old_values"?: NonNullable<Json>,"organization_id"?: string,"requirement_id"?: string,"status"?: Database["public"]['Enums']["requirement_status"],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "requirement_versions_changed_by_fkey"
      columns: ["changed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirement_versions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "requirement_versions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "requirement_versions_requirement_id_fkey"
      columns: ["requirement_id"]
isOneToOne: false
      referencedRelation: "workforce_requirements"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_items": {
                  Row: {
                    "created_at": string,"kind": string,"organization_id": string,"saved_by": string | null,"target_organization_id": string
                  }
                  Insert: {
                    "created_at"?: string,"kind"?: string,"organization_id": string,"saved_by"?: string | null,"target_organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"kind"?: string,"organization_id"?: string,"saved_by"?: string | null,"target_organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_items_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_items_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "saved_items_saved_by_fkey"
      columns: ["saved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_items_target_organization_id_fkey"
      columns: ["target_organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_items_target_organization_id_fkey"
      columns: ["target_organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"saved_jobs": {
                  Row: {
                    "created_at": string,"job_id": string,"worker_user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"job_id": string,"worker_user_id"?: string
                  }
                  Update: {
                    "created_at"?: string,"job_id"?: string,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_jobs_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_jobs_worker_user_id_fkey"
      columns: ["worker_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"saved_searches": {
                  Row: {
                    "created_at": string,"created_by": string | null,"destination_country": string | null,"id": string,"industry_code": string | null,"kind": string,"min_workers": number | null,"occupation_id": string | null,"organization_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"destination_country"?: string | null,"id"?: string,"industry_code"?: string | null,"kind"?: string,"min_workers"?: number | null,"occupation_id"?: string | null,"organization_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"destination_country"?: string | null,"id"?: string,"industry_code"?: string | null,"kind"?: string,"min_workers"?: number | null,"occupation_id"?: string | null,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "saved_searches_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_searches_destination_country_fkey"
      columns: ["destination_country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "saved_searches_industry_code_fkey"
      columns: ["industry_code"]
isOneToOne: false
      referencedRelation: "industries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "saved_searches_occupation_id_fkey"
      columns: ["occupation_id"]
isOneToOne: false
      referencedRelation: "occupations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "saved_searches_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "saved_searches_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"submission_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"from_status": Database["public"]['Enums']["submission_status"] | null,"id": number,"note": string | null,"submission_id": string,"to_status": Database["public"]['Enums']["submission_status"]
                  }
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["submission_status"] | null,"id"?: never,"note"?: string | null,"submission_id": string,"to_status": Database["public"]['Enums']["submission_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["submission_status"] | null,"id"?: never,"note"?: string | null,"submission_id"?: string,"to_status"?: Database["public"]['Enums']["submission_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "submission_events_actor_id_fkey"
      columns: ["actor_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submission_events_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "candidate_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"submission_notes": {
                  Row: {
                    "author_id": string | null,"body": string,"created_at": string,"id": number,"organization_id": string,"submission_id": string
                  }
                  Insert: {
                    "author_id"?: string | null,"body": string,"created_at"?: string,"id"?: never,"organization_id": string,"submission_id": string
                  }
                  Update: {
                    "author_id"?: string | null,"body"?: string,"created_at"?: string,"id"?: never,"organization_id"?: string,"submission_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "submission_notes_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submission_notes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "submission_notes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "submission_notes_submission_id_fkey"
      columns: ["submission_id"]
isOneToOne: false
      referencedRelation: "candidate_submissions"
      referencedColumns: ["id"]
    }
                  ]
                },"worker_documents": {
                  Row: {
                    "bucket_id": string,"created_at": string,"deleted_at": string | null,"expires_on": string | null,"file_name": string,"id": string,"mime": string,"scan_status": string,"size_bytes": number,"storage_path": string,"title": string,"type": Database["public"]['Enums']["worker_document_type"],"worker_user_id": string
                  }
                  Insert: {
                    "bucket_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"expires_on"?: string | null,"file_name": string,"id"?: string,"mime": string,"scan_status"?: string,"size_bytes": number,"storage_path": string,"title": string,"type": Database["public"]['Enums']["worker_document_type"],"worker_user_id": string
                  }
                  Update: {
                    "bucket_id"?: string,"created_at"?: string,"deleted_at"?: string | null,"expires_on"?: string | null,"file_name"?: string,"id"?: string,"mime"?: string,"scan_status"?: string,"size_bytes"?: number,"storage_path"?: string,"title"?: string,"type"?: Database["public"]['Enums']["worker_document_type"],"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_documents_worker_user_id_fkey"
      columns: ["worker_user_id"]
isOneToOne: false
      referencedRelation: "worker_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"worker_languages": {
                  Row: {
                    "cefr_level": Database["public"]['Enums']["cefr_level"],"language_code": string,"worker_user_id": string
                  }
                  Insert: {
                    "cefr_level": Database["public"]['Enums']["cefr_level"],"language_code": string,"worker_user_id": string
                  }
                  Update: {
                    "cefr_level"?: Database["public"]['Enums']["cefr_level"],"language_code"?: string,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_languages_language_code_fkey"
      columns: ["language_code"]
isOneToOne: false
      referencedRelation: "languages"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "worker_languages_worker_user_id_fkey"
      columns: ["worker_user_id"]
isOneToOne: false
      referencedRelation: "worker_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"worker_preferred_countries": {
                  Row: {
                    "country_code": string,"worker_user_id": string
                  }
                  Insert: {
                    "country_code": string,"worker_user_id": string
                  }
                  Update: {
                    "country_code"?: string,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_preferred_countries_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "worker_preferred_countries_worker_user_id_fkey"
      columns: ["worker_user_id"]
isOneToOne: false
      referencedRelation: "worker_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"worker_profiles": {
                  Row: {
                    "availability": Database["public"]['Enums']["worker_availability"] | null,"available_from": string | null,"created_at": string,"current_country": string,"first_name": string,"headline": string | null,"last_name": string,"occupation_id": string | null,"searchable": boolean,"user_id": string,"years_experience": number | null
                  }
                  Insert: {
                    "availability"?: Database["public"]['Enums']["worker_availability"] | null,"available_from"?: string | null,"created_at"?: string,"current_country": string,"first_name": string,"headline"?: string | null,"last_name": string,"occupation_id"?: string | null,"searchable"?: boolean,"user_id": string,"years_experience"?: number | null
                  }
                  Update: {
                    "availability"?: Database["public"]['Enums']["worker_availability"] | null,"available_from"?: string | null,"created_at"?: string,"current_country"?: string,"first_name"?: string,"headline"?: string | null,"last_name"?: string,"occupation_id"?: string | null,"searchable"?: boolean,"user_id"?: string,"years_experience"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_profiles_current_country_fkey"
      columns: ["current_country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "worker_profiles_occupation_id_fkey"
      columns: ["occupation_id"]
isOneToOne: false
      referencedRelation: "occupations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "worker_profiles_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"worker_skills": {
                  Row: {
                    "id": string,"skill": string,"worker_user_id": string
                  }
                  Insert: {
                    "id"?: string,"skill": string,"worker_user_id": string
                  }
                  Update: {
                    "id"?: string,"skill"?: string,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_skills_worker_user_id_fkey"
      columns: ["worker_user_id"]
isOneToOne: false
      referencedRelation: "worker_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"worker_work_authorizations": {
                  Row: {
                    "country_code": string,"expires_on": string | null,"worker_user_id": string
                  }
                  Insert: {
                    "country_code": string,"expires_on"?: string | null,"worker_user_id": string
                  }
                  Update: {
                    "country_code"?: string,"expires_on"?: string | null,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "worker_work_authorizations_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "worker_work_authorizations_worker_user_id_fkey"
      columns: ["worker_user_id"]
isOneToOne: false
      referencedRelation: "worker_profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"workforce_availability": {
                  Row: {
                    "available": number,"available_from": string,"confirmed_at": string,"created_at": string,"created_by": string | null,"id": string,"monthly_capacity": number,"occupation_id": string,"organization_id": string,"reminded_at": string | null,"source_country": string,"source_scope": Database["public"]['Enums']["geography_scope"],"updated_at": string
                  }
                  Insert: {
                    "available": number,"available_from": string,"confirmed_at"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"monthly_capacity": number,"occupation_id": string,"organization_id": string,"reminded_at"?: string | null,"source_country": string,"source_scope"?: never,"updated_at"?: string
                  }
                  Update: {
                    "available"?: number,"available_from"?: string,"confirmed_at"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"monthly_capacity"?: number,"occupation_id"?: string,"organization_id"?: string,"reminded_at"?: string | null,"source_country"?: string,"source_scope"?: never,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workforce_availability_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workforce_availability_occupation_id_fkey"
      columns: ["occupation_id"]
isOneToOne: false
      referencedRelation: "occupations"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "workforce_availability_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workforce_availability_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "workforce_availability_profile_occupation_fkey"
      columns: ["organization_id","occupation_id"]
isOneToOne: false
      referencedRelation: "organization_occupations"
      referencedColumns: ["organization_id","occupation_id"]
    },{
      foreignKeyName: "workforce_availability_profile_source_fkey"
      columns: ["organization_id","source_scope","source_country"]
isOneToOne: false
      referencedRelation: "organization_geographies"
      referencedColumns: ["organization_id","scope","country_code"]
    },{
      foreignKeyName: "workforce_availability_source_country_fkey"
      columns: ["source_country"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    }
                  ]
                },"workforce_requirements": {
                  Row: {
                    "accommodation": boolean,"city_region": string,"close_reason": Database["public"]['Enums']["requirement_close_reason"] | null,"closes_on": string | null,"closing_reminder_for": string | null,"country_code": string,"created_at": string,"created_by": string | null,"duration_months": number | null,"employment_type": Database["public"]['Enums']["employment_type"],"experience_years": number | null,"id": string,"industry_code": string,"max_capacity_over_percent": number,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"organization_id": string,"partner_need": Database["public"]['Enums']["partner_need"],"published_at": string | null,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency": string | null,"salary_max": number | null,"salary_min": number | null,"salary_period": Database["public"]['Enums']["salary_period"] | null,"show_identity": boolean,"skills": string | null,"start_date": string,"status": Database["public"]['Enums']["requirement_status"],"status_changed_at": string,"title": string,"updated_at": string,"visa_support": boolean,"visibility": Database["public"]['Enums']["requirement_visibility"] | null,"work_permit_support": boolean,"workers_needed": number
                  }
                  Insert: {
                    "accommodation"?: boolean,"city_region": string,"close_reason"?: Database["public"]['Enums']["requirement_close_reason"] | null,"closes_on"?: string | null,"closing_reminder_for"?: string | null,"country_code": string,"created_at"?: string,"created_by"?: string | null,"duration_months"?: number | null,"employment_type": Database["public"]['Enums']["employment_type"],"experience_years"?: number | null,"id"?: string,"industry_code": string,"max_capacity_over_percent"?: number,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"organization_id": string,"partner_need": Database["public"]['Enums']["partner_need"],"published_at"?: string | null,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency"?: string | null,"salary_max"?: number | null,"salary_min"?: number | null,"salary_period"?: Database["public"]['Enums']["salary_period"] | null,"show_identity"?: boolean,"skills"?: string | null,"start_date": string,"status"?: Database["public"]['Enums']["requirement_status"],"status_changed_at"?: string,"title": string,"updated_at"?: string,"visa_support"?: boolean,"visibility"?: Database["public"]['Enums']["requirement_visibility"] | null,"work_permit_support"?: boolean,"workers_needed": number
                  }
                  Update: {
                    "accommodation"?: boolean,"city_region"?: string,"close_reason"?: Database["public"]['Enums']["requirement_close_reason"] | null,"closes_on"?: string | null,"closing_reminder_for"?: string | null,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"duration_months"?: number | null,"employment_type"?: Database["public"]['Enums']["employment_type"],"experience_years"?: number | null,"id"?: string,"industry_code"?: string,"max_capacity_over_percent"?: number,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"organization_id"?: string,"partner_need"?: Database["public"]['Enums']["partner_need"],"published_at"?: string | null,"recruitment_preference"?: Database["public"]['Enums']["recruitment_preference"],"salary_currency"?: string | null,"salary_max"?: number | null,"salary_min"?: number | null,"salary_period"?: Database["public"]['Enums']["salary_period"] | null,"show_identity"?: boolean,"skills"?: string | null,"start_date"?: string,"status"?: Database["public"]['Enums']["requirement_status"],"status_changed_at"?: string,"title"?: string,"updated_at"?: string,"visa_support"?: boolean,"visibility"?: Database["public"]['Enums']["requirement_visibility"] | null,"work_permit_support"?: boolean,"workers_needed"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "workforce_requirements_country_code_fkey"
      columns: ["country_code"]
isOneToOne: false
      referencedRelation: "countries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "workforce_requirements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workforce_requirements_industry_code_fkey"
      columns: ["industry_code"]
isOneToOne: false
      referencedRelation: "industries"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "workforce_requirements_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "workforce_requirements_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    },{
      foreignKeyName: "workforce_requirements_salary_currency_fkey"
      columns: ["salary_currency"]
isOneToOne: false
      referencedRelation: "currencies"
      referencedColumns: ["code"]
    }
                  ]
                }
          }
          Views: {
            "v_job_applicants": {
                  Row: {
                    "applied_at": string | null,"candidate_name": string | null,"completeness": number | null,"documents": number | null,"id": string | null,"job_id": string | null,"job_title": string | null,"organization_id": string | null,"status": Database["public"]['Enums']["application_status"] | null
                  }
                  Insert: {
                           "applied_at"?: string | null,"candidate_name"?: never,"completeness"?: never,"documents"?: never,"id"?: string | null,"job_id"?: string | null,"job_title"?: never,"organization_id"?: string | null,"status"?: Database["public"]['Enums']["application_status"] | null
                         }
                        Update: {
                           "applied_at"?: string | null,"candidate_name"?: never,"completeness"?: never,"documents"?: never,"id"?: string | null,"job_id"?: string | null,"job_title"?: never,"organization_id"?: string | null,"status"?: Database["public"]['Enums']["application_status"] | null
                         }
                        Relationships: [
                    {
      foreignKeyName: "job_applications_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_applications_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "job_applications_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "v_org_limits"
      referencedColumns: ["organization_id"]
    }
                  ]
                },"v_legal_current": {
                  Row: {
                    "body": string | null,"change_summary": string | null,"is_draft": boolean | null,"published_at": string | null,"slug": string | null,"title": string | null,"version": number | null
                  }
                  Relationships: [
                    
                  ]
                },"v_my_application_timeline": {
                  Row: {
                    "actor_role": string | null,"application_id": string | null,"created_at": string | null,"from_status": Database["public"]['Enums']["application_status"] | null,"note": string | null,"to_status": Database["public"]['Enums']["application_status"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "application_events_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "job_applications"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "application_events_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "v_job_applicants"
      referencedColumns: ["id"]
    }
                  ]
                },"v_my_document_access_log": {
                  Row: {
                    "accessed_at": string | null,"document_title": string | null,"id": number | null,"organization_name": string | null,"purpose": string | null
                  }
                  Relationships: [
                    
                  ]
                },"v_my_subscription": {
                  Row: {
                    "cancel_at": string | null,"current_period_end": string | null,"organization_id": string | null,"past_due_since": string | null,"plan_code": string | null,"plan_name": string | null,"status": string | null,"trial_ends_at": string | null
                  }
                  Relationships: [
                    
                  ]
                },"v_org_analytics": {
                  Row: {
                    "country_code": string | null,"metric": Database["public"]['Enums']["analytics_metric"] | null,"occupation_id": string | null,"organization_id": string | null,"period_end": string | null,"period_start": string | null,"suppressed": boolean | null,"value": number | null
                  }
                  Relationships: [
                    
                  ]
                },"v_org_limits": {
                  Row: {
                    "active_jobs_limit": number | null,"open_jobs": number | null,"organization_id": string | null,"plan_name": string | null,"subscription_ended": boolean | null
                  }
                  Relationships: [
                    
                  ]
                },"v_plans": {
                  Row: {
                    "code": string | null,"contact_sales": boolean | null,"currency": string | null,"features": Json | null,"interval": string | null,"is_default_trial": boolean | null,"is_public": boolean | null,"limits": Json | null,"name": string | null,"org_type": Database["public"]['Enums']["organization_type"] | null,"price_minor": number | null,"sort": number | null,"trial_days": number | null
                  }
                  Insert: {
                           "code"?: string | null,"contact_sales"?: boolean | null,"currency"?: string | null,"features"?: never,"interval"?: string | null,"is_default_trial"?: boolean | null,"is_public"?: boolean | null,"limits"?: never,"name"?: string | null,"org_type"?: Database["public"]['Enums']["organization_type"] | null,"price_minor"?: number | null,"sort"?: number | null,"trial_days"?: number | null
                         }
                        Update: {
                           "code"?: string | null,"contact_sales"?: boolean | null,"currency"?: string | null,"features"?: never,"interval"?: string | null,"is_default_trial"?: boolean | null,"is_public"?: boolean | null,"limits"?: never,"name"?: string | null,"org_type"?: Database["public"]['Enums']["organization_type"] | null,"price_minor"?: number | null,"sort"?: number | null,"trial_days"?: number | null
                         }
                        Relationships: [
                    
                  ]
                },"v_platform_counts": {
                  Row: {
                    "active_jobs": number | null,"countries": number | null,"employers": number | null,"workers": number | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "accept_consents":
{ Args: { "p_consents": Json }; Returns: undefined
                           },
"accept_employer_pays_commitment":
{ Args: { "p_org": string,"p_version": number }; Returns: Json
                           },
"accept_invitation":
{ Args: { "p_token": string }; Returns: string
                           },
"accept_ownership_transfer":
{ Args: { "p_org": string }; Returns: undefined
                           },
"account_deletion_status":
{ Args: Record<PropertyKey, never>; Returns: {
              "can_cancel": boolean,"cooling_off_days": number,"erases_on": string,"requested_at": string
            }[]
                           },
"account_ops_ack":
{ Args: { "p_msg_id": number,"p_result"?: Json }; Returns: boolean
                           },
"account_ops_dequeue":
{ Args: { "p_limit"?: number }; Returns: {
              "message": Json,"msg_id": number
            }[]
                           },
"account_ops_end_sessions":
{ Args: { "p_user_id": string }; Returns: number
                           },
"account_ops_export_data":
{ Args: { "p_export": string }; Returns: Json
                           },
"account_ops_export_ready":
{ Args: { "p_export": string,"p_files_left_out"?: number,"p_size": number }; Returns: boolean
                           },
"account_ops_fan_out_legal_version":
{ Args: { "p_after"?: string,"p_limit"?: number,"p_slug": string,"p_version": number }; Returns: {
              "last_id": string,"queued": number
            }[]
                           },
"account_ops_organization_members":
{ Args: { "p_org": string }; Returns: string[]
                           },
"account_ops_user_status":
{ Args: { "p_user_id": string }; Returns: string
                           },
"add_partner_licence":
{ Args: { "p_confirmed": boolean,"p_country_code": string,"p_issuing_authority": string,"p_licence_number": string,"p_org": string,"p_valid_until": string }; Returns: string
                           },
"add_submission_note":
{ Args: { "p_body": string,"p_submission": string }; Returns: number
                           },
"add_workforce_availability":
{ Args: { "p_available": number,"p_available_from": string,"p_monthly_capacity": number,"p_occupation_id": string,"p_org": string,"p_source_country": string }; Returns: string
                           },
"admin_appeal_stats":
{ Args: { "p_days"?: number }; Returns: {
              "decided": number,"open": number,"overdue": number,"restored": number
            }[]
                           },
"admin_application_counts":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "count": number,"status": Database["public"]['Enums']["application_status"]
            }[]
                           },
"admin_decide_partner":
{ Args: { "p_decision": string,"p_info_step"?: string,"p_org": string,"p_reason": string }; Returns: Json
                           },
"admin_delete_direct_hiring_rule":
{ Args: { "p_reason": string,"p_rule": string }; Returns: undefined
                           },
"admin_export_legal_documents":
{ Args: { "p_after_slug"?: string,"p_after_version"?: number,"p_limit"?: number }; Returns: {
              "body": string,"change_summary": string,"is_draft": boolean,"published_at": string,"slug": string,"title": string,"version": number
            }[]
                           },
"admin_get_appeal":
{ Args: { "p_id": number }; Returns: {
              "action": string,"decided_at": string,"decided_on": string,"decision_reasons": string,"decision_report_id": number,"due_at": string,"grounds": string,"id": number,"in_effect": boolean,"lodged_at": string,"moderation_action_id": number,"organization_id": string,"organization_name": string,"overdue": boolean,"own_decision": boolean,"reasons": string,"status": Database["public"]['Enums']["appeal_status"],"target_id": string,"target_type": string,"title": string
            }[]
                           },
"admin_get_job":
{ Args: { "p_job": string }; Returns: {
              "city": string,"country_code": string,"created_at": string,"description": string,"history": Json,"id": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"organization_id": string,"organization_name": string,"status": Database["public"]['Enums']["job_status"],"title": string
            }[]
                           },
"admin_get_organization":
{ Args: { "p_org": string }; Returns: {
              "display_name": string,"id": string,"legal_name": string,"members": Json,"slug": string,"status": Database["public"]['Enums']["organization_status"],"vacancies": Json
            }[]
                           },
"admin_get_partner_moderation":
{ Args: { "p_org": string }; Returns: {
              "history": Json,"listed": boolean,"listings": Json,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"organization_id": string,"organization_type": Database["public"]['Enums']["organization_type"],"status": Database["public"]['Enums']["organization_status"]
            }[]
                           },
"admin_get_partner_review":
{ Args: { "p_org": string }; Returns: {
              "based_in_country": string,"commitment": Json,"created_at": string,"decisions": Json,"description": string,"display_name": string,"due_at": string,"founded_year": number,"geographies": Json,"id": string,"identifier_links": Json,"industries": Json,"industry_code": string,"info_step": string,"languages": Json,"legal_entity_identifier": string,"legal_entity_identifier_kind": string,"legal_name": string,"listed_at": string,"occupations": Json,"owner_email": string,"recruitment_type": Database["public"]['Enums']["recruitment_preference"],"review_status": Database["public"]['Enums']["partner_review_status"],"service_types": Json,"status": Database["public"]['Enums']["organization_status"],"submitted_at": string,"type": Database["public"]['Enums']["organization_type"],"website": string,"workforce_size_band": Database["public"]['Enums']["workforce_size_band"]
            }[]
                           },
"admin_get_plan_price":
{ Args: { "p_code": string }; Returns: {
              "code": string,"currency": string,"interval": string,"name": string,"org_type": Database["public"]['Enums']["organization_type"],"price_minor": number,"price_ref": string,"product_ref": string
            }[]
                           },
"admin_get_report":
{ Args: { "p_id": number }; Returns: {
              "category": Database["public"]['Enums']["report_category"],"content_path": string,"created_at": string,"decision": string,"decision_due_at": string,"details": string,"due_at": string,"handled_at": string,"id": number,"item_context": Json,"item_id": string,"item_moderation_state": Database["public"]['Enums']["job_moderation_state"],"job_id": string,"job_moderation_state": Database["public"]['Enums']["job_moderation_state"],"job_status": Database["public"]['Enums']["job_status"],"job_title": string,"organization_id": string,"organization_moderation_state": Database["public"]['Enums']["job_moderation_state"],"organization_name": string,"organization_slug": string,"organization_status": Database["public"]['Enums']["organization_status"],"organization_type": Database["public"]['Enums']["organization_type"],"overdue": boolean,"priority": number,"reference": string,"reporter_email": string,"reporter_kind": string,"resolution_note": string,"status": Database["public"]['Enums']["report_status"],"target_type": Database["public"]['Enums']["report_target_type"]
            }[]
                           },
"admin_get_user":
{ Args: { "p_user_id": string }; Returns: {
              "account_kind": Database["public"]['Enums']["account_kind"],"applications_submitted": number,"created_at": string,"display_name": string,"email": string,"id": string,"memberships": Json,"status": Database["public"]['Enums']["profile_status"],"vacancies_created": number
            }[]
                           },
"admin_legal_acceptance":
{ Args: Record<PropertyKey, never>; Returns: {
              "accepted": number,"audience": string,"slug": string,"total": number
            }[]
                           },
"admin_list_appeals":
{ Args: { "p_after_due_at"?: string,"p_after_id"?: number,"p_limit"?: number,"p_status"?: string }; Returns: {
              "decided_at": string,"due_at": string,"id": number,"lodged_at": string,"moderation_action_id": number,"organization_id": string,"organization_name": string,"overdue": boolean,"status": Database["public"]['Enums']["appeal_status"],"target_type": string,"title": string
            }[]
                           },
"admin_list_direct_hiring_rule_history":
{ Args: { "p_before_id"?: number,"p_limit"?: number }; Returns: {
              "action": string,"actor_name": string,"after": Json,"before": Json,"created_at": string,"id": number,"reason": string,"rule_id": string
            }[]
                           },
"admin_list_direct_hiring_rules":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"destination_country": string,"destination_name": string,"id": string,"legal_opinion_ref": string,"notice": string,"review_due": boolean,"rule": Database["public"]['Enums']["direct_hiring_rule_value"],"source_country": string,"source_name": string,"updated_at": string,"updated_by_name": string
            }[]
                           },
"admin_list_enterprise_organizations":
{ Args: Record<PropertyKey, never>; Returns: {
              "display_name": string,"id": string,"org_type": Database["public"]['Enums']["organization_type"],"plan_code": string
            }[]
                           },
"admin_list_legal_documents":
{ Args: Record<PropertyKey, never>; Returns: {
              "is_draft": boolean,"published_at": string,"slug": string,"title": string,"version": number
            }[]
                           },
"admin_list_limit_overrides":
{ Args: Record<PropertyKey, never>; Returns: {
              "changed_at": string,"expired": boolean,"expires_at": string,"limit_key": string,"limit_label": string,"limit_value": number,"organization_id": string,"organization_name": string,"plan_code": string,"plan_limit": number,"reason": string
            }[]
                           },
"admin_list_moderation_actions":
{ Args: { "p_after_id"?: number,"p_limit"?: number }; Returns: {
              "action": string,"actor_id": string,"created_at": string,"id": number,"statement_of_reasons": string,"target_id": string,"target_name": string,"target_type": string
            }[]
                           },
"admin_list_partner_licences":
{ Args: { "p_org": string }; Returns: {
              "confirmed_at": string,"country_code": string,"created_at": string,"evidence_mime": string,"evidence_scan_status": string,"evidence_size_bytes": number,"id": string,"issuing_authority": string,"licence_number": string,"partner_terms_version": number,"status": string,"updated_at": string,"valid_until": string
            }[]
                           },
"admin_list_partner_reviews":
{ Args: { "p_after_at"?: string,"p_after_id"?: string,"p_limit"?: number }; Returns: {
              "based_in_country": string,"display_name": string,"due_at": string,"id": string,"legal_entity_identifier": string,"legal_entity_identifier_kind": string,"legal_name": string,"review_status": Database["public"]['Enums']["partner_review_status"],"same_identifier": boolean,"submitted_at": string,"type": Database["public"]['Enums']["organization_type"],"website": string
            }[]
                           },
"admin_list_plan_history":
{ Args: { "p_before_id"?: number,"p_code": string,"p_limit"?: number }; Returns: {
              "actor_id": string,"actor_name": string,"after": Json,"before": Json,"created_at": string,"feature_key": string,"id": number,"label": string,"limit_key": string,"operation": string,"reason": string,"table_name": string
            }[]
                           },
"admin_list_plans":
{ Args: Record<PropertyKey, never>; Returns: {
              "code": string,"contact_sales": boolean,"currency": string,"features": Json,"is_public": boolean,"limits": Json,"name": string,"org_type": Database["public"]['Enums']["organization_type"],"price_minor": number,"sort": number,"trial_days": number
            }[]
                           },
"admin_list_reports":
{ Args: { "p_after_due_at"?: string,"p_after_id"?: number,"p_after_priority"?: number,"p_limit"?: number,"p_status"?: string,"p_type"?: Database["public"]['Enums']["report_target_type"] }; Returns: {
              "category": Database["public"]['Enums']["report_category"],"created_at": string,"due_at": string,"handled_at": string,"id": number,"overdue": boolean,"priority": number,"reference": string,"status": Database["public"]['Enums']["report_status"],"target_label": string,"target_type": Database["public"]['Enums']["report_target_type"]
            }[]
                           },
"admin_list_retention_policies":
{ Args: Record<PropertyKey, never>; Returns: {
              "days": number,"description": string,"editable": boolean,"entity": string,"label": string
            }[]
                           },
"admin_list_settings":
{ Args: Record<PropertyKey, never>; Returns: {
              "key": string,"label": string,"max": number,"min": number,"release_feature": string,"release_gaps": (string)[],"value": string,"value_type": string
            }[]
                           },
"admin_moderation_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "hidden_vacancies": number,"suspended_organizations": number,"suspended_users": number
            }[]
                           },
"admin_network_counts":
{ Args: { "p_from": string,"p_period"?: string,"p_to": string }; Returns: {
              "count": number,"metric": string,"period_start": string
            }[]
                           },
"admin_network_kpis":
{ Args: { "p_from": string,"p_to": string }; Returns: {
              "base": number,"label": string,"metric": string,"range_figure": boolean,"unit": string,"value": number
            }[]
                           },
"admin_partner_search_stats":
{ Args: { "p_from": string,"p_kind": string,"p_to": string }; Returns: {
              "min_count": number,"searches": number,"with_results": number,"zero_by_destination": Json,"zero_results": number
            }[]
                           },
"admin_record_plan_price":
{ Args: { "p_code": string,"p_price_minor": number,"p_price_ref": string,"p_reason": string }; Returns: boolean
                           },
"admin_remove_limit_override":
{ Args: { "p_limit_key": string,"p_org": string,"p_reason": string }; Returns: undefined
                           },
"admin_search_audit":
{ Args: { "p_action"?: string,"p_actor"?: string,"p_after_at"?: string,"p_after_id"?: number,"p_entity_id"?: string,"p_entity_type"?: string,"p_from"?: string,"p_limit"?: number,"p_to"?: string }; Returns: {
              "action": string,"actor_id": string,"created_at": string,"entity_id": string,"entity_type": string,"id": number,"ip": unknown,"metadata": Json
            }[]
                           },
"admin_search_jobs":
{ Args: { "p_after_at"?: string,"p_after_id"?: string,"p_limit"?: number,"p_term": string }; Returns: {
              "created_at": string,"id": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"organization_name": string,"status": Database["public"]['Enums']["job_status"],"title": string
            }[]
                           },
"admin_search_organizations":
{ Args: { "p_after_id"?: string,"p_after_name"?: string,"p_limit"?: number,"p_term": string }; Returns: {
              "display_name": string,"id": string,"legal_name": string,"slug": string,"status": Database["public"]['Enums']["organization_status"]
            }[]
                           },
"admin_search_users":
{ Args: { "p_after_id"?: string,"p_after_name"?: string,"p_limit"?: number,"p_term": string }; Returns: {
              "account_kind": Database["public"]['Enums']["account_kind"],"created_at": string,"display_name": string,"email": string,"id": string,"status": Database["public"]['Enums']["profile_status"]
            }[]
                           },
"admin_set_limit_override":
{ Args: { "p_expires_at": string,"p_limit_key": string,"p_org": string,"p_reason": string,"p_value": number }; Returns: boolean
                           },
"admin_set_organization_type":
{ Args: { "p_org": string,"p_reason": string,"p_type": Database["public"]['Enums']["organization_type"] }; Returns: undefined
                           },
"admin_set_plan_feature":
{ Args: { "p_code": string,"p_enabled": boolean,"p_feature_key": string,"p_reason": string }; Returns: boolean
                           },
"admin_set_plan_limit":
{ Args: { "p_code": string,"p_limit_key": string,"p_reason"?: string,"p_value"?: number }; Returns: boolean
                           },
"admin_set_report_status":
{ Args: { "p_id": number,"p_note"?: string,"p_status": Database["public"]['Enums']["report_status"] }; Returns: undefined
                           },
"admin_set_retention_policy":
{ Args: { "p_days": number,"p_entity": string,"p_reason": string }; Returns: boolean
                           },
"admin_set_setting":
{ Args: { "p_key": string,"p_reason": string,"p_value": string }; Returns: boolean
                           },
"admin_staff_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"admin_update_plan":
{ Args: { "p_code": string,"p_is_public": boolean,"p_name": string,"p_reason": string,"p_trial_days": number }; Returns: boolean
                           },
"admin_update_plan_bundle":
{ Args: { "p_changes": Json,"p_code": string,"p_reason": string }; Returns: number
                           },
"admin_upsert_direct_hiring_rule":
{ Args: { "p_destination"?: string,"p_legal_opinion_ref": string,"p_notice": string,"p_reason": string,"p_rule": string,"p_source": string }; Returns: boolean
                           },
"answer_invitation":
{ Args: { "p_answer": string,"p_invitation": string,"p_org": string,"p_reason"?: string }; Returns: Database["public"]['Enums']["invitation_status"]
                           },
"application_documents":
{ Args: { "p_application_id": string }; Returns: {
              "available": boolean,"expires_on": string,"file_name": string,"id": string,"size_bytes": number,"title": string,"type": Database["public"]['Enums']["worker_document_type"]
            }[]
                           },
"application_profile_changed":
{ Args: { "p_application_id": string }; Returns: boolean
                           },
"apply_limits":
{ Args: Record<PropertyKey, never>; Returns: {
              "cover_note_max_chars": number,"documents_max": number
            }[]
                           },
"apply_to_job":
{ Args: { "p_document_ids"?: (string)[],"p_job_id": string,"p_note"?: string }; Returns: {
              "application_id": string,"outcome": string
            }[]
                           },
"approve_submission":
{ Args: { "p_document_ids"?: (string)[],"p_submission": string }; Returns: Database["public"]['Enums']["submission_status"]
                           },
"audit_export_count":
{ Args: { "p_month": string }; Returns: number
                           },
"audit_export_month":
{ Args: { "p_after_at"?: string,"p_after_id"?: number,"p_limit"?: number,"p_month": string }; Returns: Json
                           },
"audit_record_external":
{ Args: { "p_action": string,"p_actor_id"?: string,"p_entity_id": string,"p_entity_type": string,"p_metadata"?: Json }; Returns: boolean
                           },
"billing_apply_event":
{ Args: { "p_event_id": string }; Returns: string
                           },
"billing_checkout_start":
{ Args: { "p_billing_country": string,"p_disclosed_trial_days"?: number,"p_org": string,"p_plan_code": string,"p_provider"?: string,"p_registration_number": string,"p_terms_version": number,"p_vat_id": string }; Returns: {
              "customer_ref": string,"price_ref": string,"slug": string,"trial_days": number
            }[]
                           },
"billing_checkout_state":
{ Args: { "p_org": string }; Returns: {
              "billing_country": string,"has_customer": boolean,"identifier": string,"identifier_kind": string,"identifier_locked": boolean,"registration_number": string,"trial_used": boolean,"vat_id": string
            }[]
                           },
"billing_ingest_event":
{ Args: { "p_kind": string,"p_payload": Json,"p_provider": string,"p_provider_created_at": string,"p_provider_event_id": string,"p_signature_valid": boolean }; Returns: string
                           },
"billing_portal_start":
{ Args: { "p_org": string }; Returns: {
              "customer_ref": string,"organization_type": Database["public"]['Enums']["organization_type"],"slug": string
            }[]
                           },
"billing_reconcile_records":
{ Args: { "p_after"?: string,"p_limit"?: number,"p_provider": string }; Returns: Json
                           },
"billing_reconcile_report":
{ Args: { "p_checked": number,"p_difference_count": number,"p_differences": Json,"p_provider": string }; Returns: number
                           },
"billing_record_worker_attempt":
{ Args: { "p_user": string }; Returns: boolean
                           },
"billing_usage":
{ Args: { "p_org": string }; Returns: {
              "limit_key": string,"limit_value": number,"used": number
            }[]
                           },
"billing_webhook_rejected":
{ Args: { "p_provider": string,"p_reason": string }; Returns: boolean
                           },
"bulk_set_application_status":
{ Args: { "p_application_ids": (string)[],"p_note"?: string,"p_status": Database["public"]['Enums']["application_status"] }; Returns: {
              "application_id": string,"error_code": string,"ok": boolean
            }[]
                           },
"bulk_set_submission_status":
{ Args: { "p_note"?: string,"p_status": Database["public"]['Enums']["submission_status"],"p_submission_ids": (string)[] }; Returns: {
              "error_code": string,"ok": boolean,"submission_id": string
            }[]
                           },
"cancel_account_deletion":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"cancel_ownership_transfer":
{ Args: { "p_org": string }; Returns: undefined
                           },
"change_member_role":
{ Args: { "p_org": string,"p_role": Database["public"]['Enums']["member_role"],"p_user": string }; Returns: undefined
                           },
"choose_account_kind":
{ Args: { "p_consents"?: Json,"p_kind": Database["public"]['Enums']["account_kind"],"p_org_type"?: Database["public"]['Enums']["organization_type"] }; Returns: Database["public"]['Enums']["account_kind"]
                           },
"compare_responses":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "available_from": string,"capacity": number,"created_at": string,"decided_at": string,"decision_note": string,"experience_note": string,"fee_amount": number,"fee_currency": string,"fee_model": Database["public"]['Enums']["fee_model"],"id": string,"invitation_id": string,"organization_id": string,"partner_name": string,"partner_slug": string,"partner_type": Database["public"]['Enums']["organization_type"],"served_countries": (string)[],"status": Database["public"]['Enums']["response_status"],"submissions_allowed": boolean,"timeline_note": string,"updated_at": string,"updated_unseen": boolean,"version": number,"withdrawn_at": string
            }[]
                           },
"confirm_workforce_availability":
{ Args: { "p_listing": string }; Returns: string
                           },
"connection_target":
{ Args: { "p_slug": string }; Returns: {
              "organization_id": string,"organization_type": Database["public"]['Enums']["organization_type"]
            }[]
                           },
"count_applications_in_progress":
{ Args: { "p_job_id": string }; Returns: number
                           },
"create_organization":
{ Args: { "p_based_in_country": string,"p_description"?: string,"p_display_name": string,"p_identifier"?: string,"p_identifier_kind"?: string,"p_industry_code": string,"p_legal_name": string,"p_type": Database["public"]['Enums']["organization_type"],"p_website"?: string }; Returns: Json
                           },
"create_vacancies_from_requirement":
{ Args: { "p_expected_linked": number,"p_expected_updated_at": string,"p_org": string,"p_requirement": string }; Returns: {
              "id": string,"occupation_id": string,"title": string
            }[]
                           },
"create_worker_passport":
{ Args: { "p_current_country": string,"p_first_name": string,"p_last_name": string,"p_preferred_lang"?: string }; Returns: undefined
                           },
"data_export_access_grant":
{ Args: { "p_export": string }; Returns: {
              "bucket_id": string,"file_name": string,"object_path": string
            }[]
                           },
"decide_appeal":
{ Args: { "p_appeal": number,"p_outcome": string,"p_reasons": string }; Returns: {
              "reversal_action_id": number,"status": Database["public"]['Enums']["appeal_status"]
            }[]
                           },
"decide_response":
{ Args: { "p_decision": Database["public"]['Enums']["response_status"],"p_note"?: string,"p_org": string,"p_response": string }; Returns: Database["public"]['Enums']["response_status"]
                           },
"decline_submission":
{ Args: { "p_submission": string }; Returns: Database["public"]['Enums']["submission_status"]
                           },
"delete_partner_licence":
{ Args: { "p_licence": string }; Returns: undefined
                           },
"delete_saved_search":
{ Args: { "p_id": string,"p_org": string }; Returns: undefined
                           },
"delete_worker_document":
{ Args: { "p_document_id": string }; Returns: undefined
                           },
"delete_workforce_availability":
{ Args: { "p_listing": string }; Returns: undefined
                           },
"document_access_grant":
{ Args: { "p_document_id": string,"p_purpose": string }; Returns: {
              "bucket_id": string,"file_name": string,"object_path": string
            }[]
                           },
"document_set_scan_status":
{ Args: { "p_document_id": string,"p_mime": string,"p_path": string,"p_size": number,"p_status": string }; Returns: string
                           },
"employer_search_access":
{ Args: { "p_org": string }; Returns: boolean
                           },
"erase_user":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"export_applicants":
{ Args: { "p_job_id": string,"p_stage"?: Database["public"]['Enums']["application_status"] }; Returns: Json
                           },
"extend_requirement":
{ Args: { "p_expected_updated_at": string,"p_org": string,"p_requirement": string }; Returns: Json
                           },
"follower_count":
{ Args: { "p_org": string }; Returns: Json
                           },
"get_applicant":
{ Args: { "p_application_id": string }; Returns: {
              "applicant_name": string,"applied_at": string,"id": string,"job_id": string,"job_title": string,"note_max_chars": number,"organization_id": string,"shortlisting_available": boolean,"stage_change_blocked": string,"status": Database["public"]['Enums']["application_status"]
            }[]
                           },
"get_applicant_access":
{ Args: { "p_organization_id": string }; Returns: {
              "csv_export_available": boolean,"note_max_chars": number,"shortlisting_available": boolean,"stage_change_blocked": string
            }[]
                           },
"get_board_counts":
{ Args: { "p_job_id": string }; Returns: {
              "status": Database["public"]['Enums']["application_status"],"total": number
            }[]
                           },
"get_company_page":
{ Args: { "p_slug": string }; Returns: {
              "based_in_country": string,"based_in_country_name": string,"description": string,"display_name": string,"industry_code": string,"industry_name": string,"job_order_count": number,"job_orders": Json,"open_vacancy_count": number,"slug": string,"vacancies": Json,"viewer_partner_slug": string,"viewer_role": Database["public"]['Enums']["member_role"],"website": string
            }[]
                           },
"get_dashboard_applications":
{ Args: { "p_organization_id": string }; Returns: {
              "recent": number,"status": Database["public"]['Enums']["application_status"],"total": number
            }[]
                           },
"get_dashboard_first_steps":
{ Args: { "p_organization_id": string }; Returns: {
              "plan_chosen": boolean,"team_invited": boolean,"vacancy_published": boolean
            }[]
                           },
"get_dashboard_plan":
{ Args: { "p_organization_id": string }; Returns: {
              "current_period_end": string,"past_due_since": string,"plan_name": string,"status": string,"subscription_ended": boolean,"trial_ends_at": string
            }[]
                           },
"get_employer_network_dashboard":
{ Args: { "p_org": string }; Returns: {
              "draft_requirements": number,"followed_companies": number,"invitations_accepted": number,"invitations_declined": number,"invitations_responded": number,"invitations_waiting": number,"invited_partners": number,"invited_recruitment": number,"invited_staffing": number,"open_requirements": number,"paused_requirements": number,"requirements": Json,"responses_shortlisted": number,"responses_updated": number,"responses_waiting": number,"saved_partners": number,"selected_partners": number,"submission_stages": Json
            }[]
                           },
"get_employer_submission":
{ Args: { "p_submission": string }; Returns: {
              "candidate_name": string,"id": string,"note": string,"organization_id": string,"partner_name": string,"partner_slug": string,"profile_snapshot": Json,"requirement_id": string,"requirement_title": string,"share_active": boolean,"status": Database["public"]['Enums']["submission_status"],"withdrawn_at": string,"worker_approved_at": string
            }[]
                           },
"get_invitation":
{ Args: { "p_invitation": string,"p_org": string }; Returns: {
              "accommodation": boolean,"answered_at": string,"city_region": string,"closes_on": string,"countries": (string)[],"country_code": string,"decline_reason": string,"duration_months": number,"employer_company_slug": string,"employer_name": string,"employment_type": Database["public"]['Enums']["employment_type"],"experience_years": number,"expired_at": string,"id": string,"industry_code": string,"invited_at": string,"occupations": Json,"partner_need": Database["public"]['Enums']["partner_need"],"published_on": string,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"requirement_id": string,"requirement_status": Database["public"]['Enums']["requirement_status"],"responded_at": string,"salary_currency": string,"salary_max": number,"salary_min": number,"salary_period": Database["public"]['Enums']["salary_period"],"skills": string,"start_date": string,"status": Database["public"]['Enums']["invitation_status"],"title": string,"viewed_at": string,"visa_support": boolean,"withdrawn_at": string,"work_permit_support": boolean,"workers_needed": number
            }[]
                           },
"get_job_order":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "accommodation": boolean,"city_region": string,"closes_on": string,"countries": (string)[],"country_code": string,"duration_months": number,"eligible": boolean,"employer_company_slug": string,"employer_name": string,"employment_type": Database["public"]['Enums']["employment_type"],"experience_years": number,"id": string,"industry_code": string,"occupations": Json,"open": boolean,"partner_need": Database["public"]['Enums']["partner_need"],"published_on": string,"reasons": (string)[],"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"response_count": number,"responses_fewer_than": number,"salary_currency": string,"salary_max": number,"salary_min": number,"salary_period": Database["public"]['Enums']["salary_period"],"skills": string,"start_date": string,"title": string,"visa_support": boolean,"work_permit_support": boolean,"workers_needed": number
            }[]
                           },
"get_my_application":
{ Args: { "p_id": string }; Returns: {
              "applied_at": string,"cover_note": string,"employer_display_name": string,"id": string,"job_id": string,"job_title": string,"status": Database["public"]['Enums']["application_status"],"vacancy_is_open": boolean
            }[]
                           },
"get_org_analytics":
{ Args: { "p_dimension"?: string,"p_org": string,"p_period"?: string }; Returns: {
              "country_code": string,"metric": Database["public"]['Enums']["analytics_metric"],"occupation_id": string,"organization_id": string,"period_end": string,"period_start": string,"suppressed": boolean,"value": number
            }[]
                           },
"get_partner_dashboard":
{ Args: { "p_org": string }; Returns: {
              "fitting_job_orders": number,"invitations_awaiting": number,"licences_current": number,"licences_expired": number,"licences_expiring": number,"listed": boolean,"listings_due": number,"listings_stale": number,"listings_total": number,"matching_employers": number,"next_licence_expiry": string,"oldest_listing_confirmed_at": string,"organization_type": Database["public"]['Enums']["organization_type"],"profile_hidden": boolean,"profile_missing": string,"profile_updated_at": string,"profile_views_30d": number,"profile_views_fewer_than": number,"profile_views_in_plan": boolean,"profile_views_suppressed": boolean,"responses_declined": number,"responses_open": number,"responses_selected": number,"responses_shortlisted": number,"review_status": Database["public"]['Enums']["partner_review_status"],"submission_stages": Json
            }[]
                           },
"get_partner_profile":
{ Args: { "p_key"?: string,"p_proof"?: string,"p_slug": string }; Returns: {
              "based_in_country": string,"based_in_country_name": string,"commitment_current": boolean,"description": string,"display_name": string,"founded_year": number,"industries": Json,"languages": Json,"listings": Json,"occupations": Json,"organization_type": Database["public"]['Enums']["organization_type"],"profile_updated_at": string,"recruitment_type": Database["public"]['Enums']["recruitment_preference"],"served_countries": Json,"service_types": (Database["public"]['Enums']["partner_service_type"])[],"slug": string,"source_countries": Json,"viewer_is_member": boolean,"website": string,"workforce_size_band": Database["public"]['Enums']["workforce_size_band"]
            }[]
                           },
"get_public_job":
{ Args: { "p_id": string }; Returns: {
              "accommodation": boolean,"city": string,"country": string,"country_code": string,"created_at": string,"description": string,"employer_company_slug": string,"employer_country": string,"employer_description": string,"employer_display_name": string,"employer_industry": string,"employer_website": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"industry": string,"occupation": string,"published_at": string,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency": string,"salary_max": number,"salary_min": number,"salary_period": Database["public"]['Enums']["salary_period"],"title": string,"visa_support": boolean
            }[]
                           },
"get_public_settings":
{ Args: Record<PropertyKey, never>; Returns: {
              "key": string,"value": string
            }[]
                           },
"get_response":
{ Args: { "p_org": string,"p_response": string }; Returns: {
              "available_from": string,"capacity": number,"country_code": string,"created_at": string,"decided_at": string,"decision_note": string,"employer_name": string,"experience_note": string,"fee_amount": number,"fee_currency": string,"fee_model": Database["public"]['Enums']["fee_model"],"id": string,"invitation_id": string,"max_capacity": number,"notes": string,"partner_name": string,"partner_slug": string,"requirement_id": string,"requirement_status": Database["public"]['Enums']["requirement_status"],"status": Database["public"]['Enums']["response_status"],"submissions_allowed": boolean,"timeline_note": string,"title": string,"updated_at": string,"updated_unseen": boolean,"version": number,"withdrawal_reason": string,"withdrawn_at": string,"workers_needed": number
            }[]
                           },
"get_response_eligibility":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "applies": boolean,"can_respond": boolean,"detail": string,"invited": boolean,"licence_missing": (string)[],"limit_value": number,"max_capacity": number,"period_resets_at": string,"refusal": string,"requirement_id": string,"response_id": string,"response_status": Database["public"]['Enums']["response_status"],"used": number
            }[]
                           },
"grant_platform_role":
{ Args: { "p_reason": string,"p_role": string,"p_user_id": string }; Returns: undefined
                           },
"hiring_rule_notice":
{ Args: { "p_destination"?: string,"p_source": string }; Returns: {
              "notice": string,"rule": Database["public"]['Enums']["direct_hiring_rule_value"]
            }[]
                           },
"invitation_preview":
{ Args: { "p_token": string }; Returns: {
              "email": string,"expires_at": string,"organization_name": string,"organization_type": Database["public"]['Enums']["organization_type"],"role": Database["public"]['Enums']["member_role"]
            }[]
                           },
"invite_member":
{ Args: { "p_email": string,"p_org": string,"p_role": string }; Returns: {
              "expires_at": string,"token": string
            }[]
                           },
"invite_partners":
{ Args: { "p_org": string,"p_partners": (string)[],"p_requirement": string,"p_source": string }; Returns: {
              "already_invited": boolean,"invitation_id": string,"organization_id": string,"status": Database["public"]['Enums']["invitation_status"]
            }[]
                           },
"item_moderation":
{ Args: { "p_org": string,"p_target_id": string,"p_target_type": string }; Returns: {
              "decided_at": string,"moderation_action_id": number,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"reasons": string
            }[]
                           },
"list_applicant_events":
{ Args: { "p_application_id": string }; Returns: {
              "actor_kind": string,"actor_name": string,"created_at": string,"from_status": Database["public"]['Enums']["application_status"],"id": number,"note": string,"to_status": Database["public"]['Enums']["application_status"]
            }[]
                           },
"list_application_notes":
{ Args: { "p_application_id": string,"p_before_id"?: number }; Returns: {
              "author_name": string,"body": string,"created_at": string,"has_more": boolean,"id": number
            }[]
                           },
"list_employer_submissions":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_org": string,"p_requirement"?: string,"p_stage"?: Database["public"]['Enums']["submission_status"] }; Returns: {
              "candidate_name": string,"id": string,"partner_name": string,"partner_slug": string,"requirement_id": string,"requirement_title": string,"stage_changed_at": string,"status": Database["public"]['Enums']["submission_status"],"total_count": number,"worker_approved_at": string
            }[]
                           },
"list_followed_companies":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "based_in_country": string,"based_in_country_name": string,"display_name": string,"followed_at": string,"next_cursor": string,"organization_id": string,"organization_type": Database["public"]['Enums']["organization_type"],"slug": string,"total": number
            }[]
                           },
"list_invitation_changes":
{ Args: { "p_invitation": string,"p_org": string }; Returns: {
              "changed_fields": (string)[],"created_at": string,"new_values": Json,"old_values": Json,"version": number
            }[]
                           },
"list_job_orders":
{ Args: { "p_cursor"?: string,"p_destination"?: string,"p_industry"?: string,"p_limit"?: number,"p_occupation"?: string,"p_org": string,"p_recruitment"?: Database["public"]['Enums']["recruitment_preference"],"p_source"?: string,"p_start_from"?: string,"p_start_to"?: string,"p_workers_max"?: number,"p_workers_min"?: number }; Returns: {
              "city_region": string,"countries": (string)[],"country_code": string,"eligible": boolean,"employer_company_slug": string,"employer_name": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"industry_code": string,"next_cursor": string,"occupations": Json,"published_on": string,"reasons": (string)[],"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"response_count": number,"responses_fewer_than": number,"start_date": string,"title": string,"workers_needed": number
            }[]
                           },
"list_my_appeals":
{ Args: { "p_action"?: number,"p_job"?: string }; Returns: {
              "action": string,"appeal_decided_at": string,"appeal_id": number,"appeal_reasons": string,"appeal_status": Database["public"]['Enums']["appeal_status"],"appeal_until": string,"can_appeal": boolean,"decided_at": string,"due_at": string,"grounds": string,"in_effect": boolean,"lodged_at": string,"moderation_action_id": number,"org_slug": string,"organization_id": string,"organization_name": string,"reasons": string,"target_days": number,"target_id": string,"target_type": string,"title": string
            }[]
                           },
"list_my_data_exports":
{ Args: Record<PropertyKey, never>; Returns: {
              "expires_at": string,"files_left_out": number,"id": string,"next_request_at": string,"ready_at": string,"requested_at": string,"size_bytes": number,"state": string
            }[]
                           },
"list_my_invitations":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_org": string,"p_status"?: Database["public"]['Enums']["invitation_status"] }; Returns: {
              "answered_at": string,"country_code": string,"employer_name": string,"id": string,"invited_at": string,"next_cursor": string,"requirement_id": string,"requirement_status": Database["public"]['Enums']["requirement_status"],"start_date": string,"status": Database["public"]['Enums']["invitation_status"],"title": string,"workers_needed": number
            }[]
                           },
"list_my_notifications":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "created_at": string,"id": string,"kind": string,"next_cursor": string,"payload": Json,"read_at": string
            }[]
                           },
"list_my_reports":
{ Args: { "p_after_created"?: string,"p_after_id"?: number,"p_limit"?: number }; Returns: {
              "category": Database["public"]['Enums']["report_category"],"created_at": string,"handled_at": string,"id": number,"reference": string,"resolution_note": string,"status": Database["public"]['Enums']["report_status"],"target_label": string,"target_type": Database["public"]['Enums']["report_target_type"]
            }[]
                           },
"list_my_responses":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_org": string }; Returns: {
              "available_from": string,"capacity": number,"country_code": string,"created_at": string,"decided_at": string,"employer_name": string,"fee_amount": number,"fee_currency": string,"fee_model": Database["public"]['Enums']["fee_model"],"id": string,"invitation_id": string,"next_cursor": string,"requirement_id": string,"requirement_status": Database["public"]['Enums']["requirement_status"],"status": Database["public"]['Enums']["response_status"],"title": string,"updated_at": string,"version": number,"withdrawn_at": string,"workers_needed": number
            }[]
                           },
"list_my_submission_requests":
{ Args: Record<PropertyKey, never>; Returns: {
              "city_region": string,"country_code": string,"country_name": string,"created_at": string,"employer_name": string,"expires_at": string,"id": string,"note": string,"partner_name": string,"partner_slug": string,"start_date": string,"submitted_by_partner": string,"title": string,"workers_needed": number
            }[]
                           },
"list_my_submissions":
{ Args: Record<PropertyKey, never>; Returns: {
              "country_code": string,"country_name": string,"created_at": string,"decided_at": string,"employer_name": string,"id": string,"partner_name": string,"partner_slug": string,"status": Database["public"]['Enums']["submission_status"],"title": string,"withdrawn_at": string,"worker_approved_at": string
            }[]
                           },
"list_organization_invitations":
{ Args: { "p_limit"?: number,"p_org": string }; Returns: {
              "email": string,"expires_at": string,"id": string,"is_open": boolean,"role": Database["public"]['Enums']["member_role"]
            }[]
                           },
"list_organization_members":
{ Args: { "p_after_user"?: string,"p_limit"?: number,"p_org": string }; Returns: {
              "accepted_at": string,"display_name": string,"email": string,"mfa_enrolled": boolean,"role": Database["public"]['Enums']["member_role"],"user_id": string
            }[]
                           },
"list_partner_submission_outcomes":
{ Args: { "p_org": string }; Returns: {
              "hired": number,"in_progress": number,"last_change_at": string,"not_selected": number,"requirement_id": string,"requirement_status": Database["public"]['Enums']["requirement_status"],"submitted": number,"title": string,"withdrawn": number
            }[]
                           },
"list_partner_submissions":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_org": string,"p_requirement"?: string }; Returns: {
              "candidate_name": string,"created_at": string,"decided_at": string,"id": string,"invited_email": string,"moderation_action_id": number,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"next_cursor": string,"note": string,"requirement_id": string,"stage_changed_at": string,"stages": Json,"status": Database["public"]['Enums']["submission_status"],"title": string,"withdrawn_at": string,"worker_approved_at": string
            }[]
                           },
"list_platform_staff":
{ Args: { "p_after_id"?: number,"p_limit"?: number }; Returns: {
              "display_name": string,"email": string,"granted_at": string,"granted_by": string,"granted_by_email": string,"id": number,"last_sign_in_at": string,"mfa_enrolled": boolean,"revoked_at": string,"role": Database["public"]['Enums']["platform_role"],"user_id": string
            }[]
                           },
"list_requirement_invitations":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "answered_at": string,"decline_reason": string,"expired_at": string,"id": string,"invited_at": string,"organization_id": string,"partner_name": string,"partner_slug": string,"partner_type": Database["public"]['Enums']["organization_type"],"responded_at": string,"source": string,"status": Database["public"]['Enums']["invitation_status"],"suggestion_criteria": (string)[],"viewed_at": string,"withdrawn_at": string
            }[]
                           },
"list_requirement_responses":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "available_from": string,"capacity": number,"created_at": string,"decided_at": string,"fee_amount": number,"fee_currency": string,"fee_model": Database["public"]['Enums']["fee_model"],"id": string,"invitation_id": string,"organization_id": string,"partner_name": string,"partner_slug": string,"status": Database["public"]['Enums']["response_status"],"updated_at": string,"updated_unseen": boolean,"version": number,"withdrawal_reason": string,"withdrawn_at": string
            }[]
                           },
"list_requirement_submissions":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "candidate_name": string,"created_at": string,"id": string,"note": string,"partner_name": string,"partner_organization_id": string,"partner_slug": string,"profile_snapshot": Json,"status": Database["public"]['Enums']["submission_status"],"withdrawn_at": string,"worker_approved_at": string
            }[]
                           },
"list_requirement_versions":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "changed_by_member": boolean,"changed_by_name": string,"changed_fields": (string)[],"created_at": string,"new_values": Json,"old_values": Json,"status": Database["public"]['Enums']["requirement_status"],"version": number
            }[]
                           },
"list_response_changes":
{ Args: { "p_org": string,"p_response": string }; Returns: {
              "changed_fields": (string)[],"created_at": string,"new_values": Json,"old_values": Json,"version": number
            }[]
                           },
"list_response_versions":
{ Args: { "p_org": string,"p_response": string }; Returns: {
              "changed_fields": (string)[],"created_at": string,"payload": Json,"version": number
            }[]
                           },
"list_saved_jobs":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "available": boolean,"employer_display_name": string,"job_id": string,"next_cursor": string,"saved_at": string,"status": Database["public"]['Enums']["job_status"],"title": string
            }[]
                           },
"list_saved_partners":
{ Args: { "p_cursor"?: string,"p_limit"?: number,"p_org": string }; Returns: {
              "based_in_country": string,"based_in_country_name": string,"display_name": string,"next_cursor": string,"organization_type": Database["public"]['Enums']["organization_type"],"partner_id": string,"saved_at": string,"served_countries": Json,"slug": string,"total": number
            }[]
                           },
"list_sitemap_companies":
{ Args: { "p_after_slug"?: string,"p_limit"?: number }; Returns: Json
                           },
"list_sitemap_jobs":
{ Args: { "p_after_created"?: string,"p_after_id"?: string,"p_limit"?: number }; Returns: Json
                           },
"list_sitemap_partners":
{ Args: { "p_after_slug"?: string,"p_limit"?: number }; Returns: Json
                           },
"list_submission_events":
{ Args: { "p_submission": string }; Returns: {
              "actor_role": string,"created_at": string,"from_status": Database["public"]['Enums']["submission_status"],"note": string,"to_status": Database["public"]['Enums']["submission_status"]
            }[]
                           },
"list_submission_notes":
{ Args: { "p_before_id"?: number,"p_submission": string }; Returns: {
              "author_name": string,"body": string,"created_at": string,"has_more": boolean,"id": number
            }[]
                           },
"mark_application_viewed":
{ Args: { "p_application_id": string }; Returns: undefined
                           },
"mark_notifications_read":
{ Args: { "p_ids"?: (string)[] }; Returns: number
                           },
"mark_submission_viewed":
{ Args: { "p_submission": string }; Returns: undefined
                           },
"moderate_job":
{ Args: { "p_action": string,"p_job": string,"p_reason": string }; Returns: undefined
                           },
"moderation_decide":
{ Args: { "p_decision": string,"p_reasons": string,"p_report"?: number,"p_target_id"?: string,"p_target_type"?: string }; Returns: {
              "moderation_action_id": number,"report_status": Database["public"]['Enums']["report_status"]
            }[]
                           },
"my_application_stage_counts":
{ Args: Record<PropertyKey, never>; Returns: {
              "status": Database["public"]['Enums']["application_status"],"total": number
            }[]
                           },
"my_applications":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_stage"?: Database["public"]['Enums']["application_status"] }; Returns: {
              "applied_at": string,"employer_display_name": string,"id": string,"job_status": Database["public"]['Enums']["job_status"],"job_title": string,"last_event_at": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"status": Database["public"]['Enums']["application_status"]
            }[]
                           },
"my_platform_roles":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["platform_role"][]
                           },
"notification_kind_catalogue":
{ Args: Record<PropertyKey, never>; Returns: {
              "audience": string,"default_email": boolean,"email_enabled": boolean,"kind": string,"label": string,"mandatory": boolean
            }[]
                           },
"notify_ack":
{ Args: { "p_attempts"?: number,"p_error"?: string,"p_notification_id"?: string,"p_outcome": string,"p_provider_message_id"?: string }; Returns: boolean
                           },
"notify_dequeue":
{ Args: { "p_limit"?: number }; Returns: Json
                           },
"notify_existing_account":
{ Args: { "p_email": string,"p_key": string,"p_proof"?: string }; Returns: undefined
                           },
"org_usage":
{ Args: { "p_keys"?: (string)[],"p_org": string }; Returns: {
              "applies": boolean,"limit_key": string,"limit_value": number,"period_resets_at": string,"plan_name": string,"used": number
            }[]
                           },
"partner_commitment_status":
{ Args: { "p_org": string }; Returns: Json
                           },
"partner_document_access_grant":
{ Args: { "p_licence": string,"p_mime"?: string,"p_purpose": string,"p_size"?: number }; Returns: {
              "bucket_id": string,"file_name": string,"object_path": string
            }[]
                           },
"partner_document_set_scan_status":
{ Args: { "p_licence": string,"p_mime": string,"p_path": string,"p_size": number,"p_status": string }; Returns: string
                           },
"partner_profile_moderation":
{ Args: { "p_org": string }; Returns: {
              "decided_at": string,"moderation_action_id": number,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"reasons": string
            }[]
                           },
"partner_review_outcome":
{ Args: { "p_org": string }; Returns: {
              "decided_at": string,"decision": string,"info_step": string,"reason": string
            }[]
                           },
"passport_limits":
{ Args: Record<PropertyKey, never>; Returns: {
              "availability_window_months": number,"skills_max": number,"work_authorization_expiry_max_years": number
            }[]
                           },
"pending_reconsents":
{ Args: Record<PropertyKey, never>; Returns: {
              "change_summary": string,"published_at": string,"slug": string,"title": string,"version": number
            }[]
                           },
"preview_partner_profile":
{ Args: { "p_org": string }; Returns: {
              "based_in_country": string,"based_in_country_name": string,"commitment_current": boolean,"description": string,"display_name": string,"founded_year": number,"industries": Json,"is_public": boolean,"languages": Json,"listings": Json,"occupations": Json,"organization_type": Database["public"]['Enums']["organization_type"],"profile_updated_at": string,"recruitment_type": Database["public"]['Enums']["recruitment_preference"],"served_countries": Json,"service_types": (Database["public"]['Enums']["partner_service_type"])[],"slug": string,"source_countries": Json,"website": string,"workforce_size_band": Database["public"]['Enums']["workforce_size_band"]
            }[]
                           },
"publish_legal_document":
{ Args: { "p_body": string,"p_change_summary": string,"p_is_draft"?: boolean,"p_slug": string,"p_title": string }; Returns: number
                           },
"publish_requirement":
{ Args: { "p_expected_updated_at": string,"p_org": string,"p_requirement": string,"p_show_identity": boolean,"p_visibility": Database["public"]['Enums']["requirement_visibility"] }; Returns: Json
                           },
"rate_limit_attempt":
{ Args: { "p_action": string,"p_key": string,"p_proof"?: string }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"record_invitation_limit_prompt":
{ Args: { "p_attempted": number,"p_org": string,"p_requirement": string }; Returns: undefined
                           },
"record_job_form_invalid":
{ Args: { "p_fields": (string)[],"p_org": string }; Returns: undefined
                           },
"record_job_limit_prompt":
{ Args: { "p_org": string }; Returns: undefined
                           },
"record_limit_prompt":
{ Args: { "p_limit_key": string,"p_org": string }; Returns: undefined
                           },
"record_profile_view":
{ Args: { "p_org": string }; Returns: undefined
                           },
"recovery_link_is_fresh":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"register_response_document":
{ Args: { "p_file_name": string,"p_mime": string,"p_org": string,"p_requirement": string,"p_size": number }; Returns: {
              "bucket_id": string,"document_id": string,"file_name": string,"object_path": string
            }[]
                           },
"reinstate_organization":
{ Args: { "p_org": string,"p_reason": string }; Returns: undefined
                           },
"reinstate_user":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"remove_member":
{ Args: { "p_org": string,"p_user": string }; Returns: undefined
                           },
"remove_response_document":
{ Args: { "p_document": string,"p_org": string }; Returns: undefined
                           },
"request_account_deletion":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"request_data_export":
{ Args: Record<PropertyKey, never>; Returns: {
              "export_id": string,"requested_at": string
            }[]
                           },
"requirement_invitation_usage":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "applies": boolean,"limit_value": number,"plan_name": string,"used": number
            }[]
                           },
"requirement_multi_country":
{ Args: { "p_org": string }; Returns: boolean
                           },
"requirement_vacancies":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "created_at": string,"id": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"status": Database["public"]['Enums']["job_status"],"title": string
            }[]
                           },
"reset_mfa":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"respond_to_invitation":
{ Args: { "p_available_from": string,"p_capacity": number,"p_experience_note": string,"p_fee_amount"?: number,"p_fee_currency"?: string,"p_fee_model": Database["public"]['Enums']["fee_model"],"p_notes"?: string,"p_org": string,"p_requirement": string,"p_timeline_note"?: string }; Returns: string
                           },
"response_document_access_grant":
{ Args: { "p_document": string }; Returns: {
              "bucket_id": string,"file_name": string,"object_path": string
            }[]
                           },
"response_document_set_scan_status":
{ Args: { "p_document": string,"p_mime": string,"p_path": string,"p_size": number,"p_status": string }; Returns: string
                           },
"revoke_platform_role":
{ Args: { "p_reason": string,"p_role": string,"p_user_id": string }; Returns: undefined
                           },
"save_employer_search":
{ Args: { "p_destination"?: string,"p_industry"?: string,"p_min_workers"?: number,"p_occupation"?: string,"p_org": string }; Returns: string
                           },
"save_requirement":
{ Args: { "p_accommodation": boolean,"p_additional_countries"?: (string)[],"p_city_region": string,"p_country_code": string,"p_duration_months"?: number,"p_employment_type": Database["public"]['Enums']["employment_type"],"p_expected_updated_at"?: string,"p_experience_years"?: number,"p_industry_code": string,"p_occupations": Json,"p_org": string,"p_partner_need": Database["public"]['Enums']["partner_need"],"p_recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"p_requirement"?: string,"p_salary_currency"?: string,"p_salary_max"?: number,"p_salary_min"?: number,"p_salary_period"?: Database["public"]['Enums']["salary_period"],"p_skills"?: string,"p_start_date": string,"p_title"?: string,"p_visa_support": boolean,"p_work_permit_support": boolean,"p_workers_needed": number }; Returns: string
                           },
"search_available_workforce":
{ Args: { "p_cursor"?: string,"p_destination": string,"p_limit"?: number,"p_occupation": string,"p_within_days": number,"p_workers_needed": number }; Returns: {
              "available_now": number,"confirmed_at": string,"display_name": string,"id": string,"listings": Json,"next_cursor": string,"organization_type": Database["public"]['Enums']["organization_type"],"slug": string,"supply": number
            }[]
                           },
"search_employers":
{ Args: { "p_cursor"?: string,"p_destination"?: string,"p_industry"?: string,"p_limit"?: number,"p_min_workers"?: number,"p_occupation"?: string,"p_org": string }; Returns: {
              "based_in_country": string,"display_name": string,"employer_id": string,"industry_code": string,"job_order_count": number,"job_orders": Json,"kind": string,"next_cursor": string,"open_vacancy_count": number,"slug": string,"website": string
            }[]
                           },
"search_jobs":
{ Args: { "p_accommodation"?: boolean,"p_city"?: string,"p_country"?: string,"p_cursor"?: string,"p_employer"?: string,"p_employment_type"?: Database["public"]['Enums']["employment_type"],"p_industry"?: string,"p_limit"?: number,"p_occupation"?: string,"p_q"?: string,"p_recruitment"?: Database["public"]['Enums']["recruitment_preference"],"p_salary_currency"?: string,"p_salary_min"?: number,"p_salary_period"?: Database["public"]['Enums']["salary_period"],"p_visa_support"?: boolean }; Returns: {
              "accommodation": boolean,"city": string,"country_code": string,"created_at": string,"employer_display_name": string,"employer_slug": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"next_cursor": string,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency": string,"salary_max": number,"salary_min": number,"salary_period": Database["public"]['Enums']["salary_period"],"title": string,"visa_support": boolean
            }[]
                           },
"search_partners":
{ Args: { "p_based_in"?: string,"p_capacity"?: number,"p_cursor"?: string,"p_destination"?: string,"p_industry"?: string,"p_key"?: string,"p_kind": string,"p_language"?: string,"p_limit"?: number,"p_occupation"?: string,"p_proof"?: string,"p_recruitment_type"?: Database["public"]['Enums']["recruitment_preference"],"p_sources_from"?: (string)[],"p_staffing_types"?: (string)[],"p_within_days"?: number,"p_workforce_size"?: string }; Returns: {
              "also_offers_staffing": boolean,"available_workforce": Json,"based_in_country": string,"capacity_confirmed_at": string,"display_name": string,"id": string,"main_occupations": Json,"matched_filters": (string)[],"next_cursor": string,"organization_type": Database["public"]['Enums']["organization_type"],"profile_updated_at": string,"served_countries": Json,"slug": string,"staffing_types": (Database["public"]['Enums']["partner_service_type"])[]
            }[]
                           },
"set_account_kind":
{ Args: { "p_consents"?: Json }; Returns: Database["public"]['Enums']["account_kind"]
                           },
"set_application_status":
{ Args: { "p_application_id": string,"p_note"?: string,"p_status": Database["public"]['Enums']["application_status"] }; Returns: undefined
                           },
"set_company_page_visibility":
{ Args: { "p_enabled": boolean,"p_org": string }; Returns: Json
                           },
"set_legal_entity_identifier":
{ Args: { "p_identifier": string,"p_kind": string,"p_org": string }; Returns: undefined
                           },
"set_notification_preferences":
{ Args: { "p_digest": boolean }; Returns: undefined
                           } |
{ Args: { "p_kinds": Json }; Returns: undefined
                           },
"set_organization_geographies":
{ Args: { "p_org": string,"p_serves_market": (string)[],"p_sources_from": (string)[] }; Returns: Json
                           },
"set_organization_workforce_offer":
{ Args: { "p_founded_year"?: number,"p_industries": (string)[],"p_languages": (string)[],"p_occupations": (string)[],"p_org": string,"p_recruitment_type": Database["public"]['Enums']["recruitment_preference"],"p_service_types": (Database["public"]['Enums']["partner_service_type"])[],"p_workforce_size_band"?: Database["public"]['Enums']["workforce_size_band"] }; Returns: Json
                           },
"set_requirement_capacity_tolerance":
{ Args: { "p_org": string,"p_percent": number,"p_requirement": string }; Returns: boolean
                           },
"set_requirement_status":
{ Args: { "p_close_reason"?: Database["public"]['Enums']["requirement_close_reason"],"p_expected_updated_at": string,"p_org": string,"p_requirement": string,"p_status": Database["public"]['Enums']["requirement_status"] }; Returns: Json
                           },
"set_submission_status":
{ Args: { "p_note"?: string,"p_status": Database["public"]['Enums']["submission_status"],"p_submission": string }; Returns: undefined
                           },
"set_submissions_allowed":
{ Args: { "p_allowed": boolean,"p_org": string,"p_response": string }; Returns: boolean
                           },
"signup_documents":
{ Args: { "p_kind": Database["public"]['Enums']["account_kind"],"p_org_type"?: Database["public"]['Enums']["organization_type"] }; Returns: {
              "change_summary": string,"published_at": string,"slug": string,"title": string,"version": number
            }[]
                           },
"submission_documents":
{ Args: { "p_submission": string }; Returns: {
              "available": boolean,"expires_on": string,"file_name": string,"id": string,"size_bytes": number,"title": string,"type": Database["public"]['Enums']["worker_document_type"]
            }[]
                           },
"submit_appeal":
{ Args: { "p_action": number,"p_grounds": string }; Returns: {
              "appeal_id": number,"due_at": string
            }[]
                           },
"submit_candidate":
{ Args: { "p_email": string,"p_note"?: string,"p_org": string,"p_requirement": string }; Returns: {
              "existing": boolean,"id": string,"status": Database["public"]['Enums']["submission_status"]
            }[]
                           },
"submit_partner_for_review":
{ Args: { "p_org": string }; Returns: Json
                           },
"submit_report":
{ Args: { "p_application"?: string,"p_category": Database["public"]['Enums']["report_category"],"p_details": string,"p_email"?: string,"p_good_faith": boolean,"p_job"?: string,"p_key": string,"p_partner"?: string,"p_path"?: string,"p_proof"?: string,"p_requirement"?: string,"p_response"?: string,"p_submission"?: string,"p_target_type": Database["public"]['Enums']["report_target_type"] }; Returns: {
              "is_duplicate": boolean,"reference": string
            }[]
                           },
"suggest_cities":
{ Args: { "p_country": string,"p_query"?: string }; Returns: string[]
                           },
"suggest_partners":
{ Args: { "p_org": string,"p_requirement": string }; Returns: {
              "also_offers_staffing": boolean,"criteria_met": (string)[],"criteria_not_met": (string)[],"display_name": string,"matching_occupations": Json,"more_partners": boolean,"organization_id": string,"organization_type": Database["public"]['Enums']["organization_type"],"profile_updated_at": string,"served_destinations": Json,"slug": string
            }[]
                           },
"suspend_organization":
{ Args: { "p_org": string,"p_reason": string }; Returns: undefined
                           },
"suspend_user":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"team_member_allowance":
{ Args: { "p_org": string }; Returns: {
              "member_limit": number,"used": number
            }[]
                           },
"toggle_follow":
{ Args: { "p_following"?: boolean,"p_org": string }; Returns: boolean
                           },
"toggle_saved_partner":
{ Args: { "p_org"?: string,"p_partner": string,"p_saved"?: boolean }; Returns: boolean
                           },
"transfer_ownership":
{ Args: { "p_new_owner": string,"p_org": string }; Returns: undefined
                           },
"unread_notification_count":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"update_organization_profile":
{ Args: { "p_based_in_country": string,"p_description": string,"p_display_name": string,"p_industry_code": string,"p_legal_name": string,"p_org": string,"p_website": string }; Returns: Json
                           },
"update_partner_licence":
{ Args: { "p_confirmed": boolean,"p_country_code": string,"p_issuing_authority": string,"p_licence": string,"p_licence_number": string,"p_valid_until": string }; Returns: undefined
                           },
"update_response":
{ Args: { "p_available_from": string,"p_capacity": number,"p_expected_version"?: number,"p_experience_note": string,"p_fee_amount"?: number,"p_fee_currency"?: string,"p_fee_model": Database["public"]['Enums']["fee_model"],"p_notes"?: string,"p_org": string,"p_response": string,"p_timeline_note"?: string }; Returns: number
                           },
"update_workforce_availability":
{ Args: { "p_available": number,"p_available_from": string,"p_listing": string,"p_monthly_capacity": number }; Returns: undefined
                           },
"withdraw_application":
{ Args: { "p_application_id": string }; Returns: undefined
                           },
"withdraw_consent":
{ Args: { "p_purpose": string }; Returns: undefined
                           },
"withdraw_invitation":
{ Args: { "p_invitation": string,"p_org": string }; Returns: Database["public"]['Enums']["invitation_status"]
                           },
"withdraw_response":
{ Args: { "p_org": string,"p_reason"?: string,"p_response": string }; Returns: Database["public"]['Enums']["response_status"]
                           },
"withdraw_submission":
{ Args: { "p_submission": string }; Returns: Database["public"]['Enums']["submission_status"]
                           }
          }
          Enums: {
            "account_kind": "worker"|"company","analytics_metric": "profile_views","appeal_status": "open"|"upheld"|"restored","application_status": "applied"|"viewed"|"shortlisted"|"interview"|"offer"|"hired"|"rejected"|"withdrawn","cefr_level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2","consent_action": "granted"|"withdrawn","data_export_status": "queued"|"ready","direct_hiring_rule_value": "allowed"|"licensed_partner_required"|"blocked","employment_type": "full_time"|"part_time"|"contract"|"temporary"|"seasonal","fee_model": "fee_per_hire"|"percent_first_year_salary"|"hourly_rate"|"monthly_rate"|"on_request","geography_scope": "sources_from"|"serves_market","invitation_status": "invited"|"viewed"|"accepted"|"declined"|"responded"|"withdrawn"|"expired","job_moderation_state": "visible"|"hidden"|"org_suspended","job_status": "draft"|"open"|"paused"|"closed"|"filled","member_role": "owner"|"admin"|"member","organization_status": "active"|"suspended","organization_type": "employer"|"recruitment_company"|"staffing_company","partner_need": "none"|"recruitment"|"staffing"|"both","partner_review_status": "onboarding"|"pending_review"|"info_requested"|"listed"|"re_review"|"declined","partner_service_type": "staffing"|"temporary"|"contract"|"project"|"permanent","platform_role": "admin"|"verification_reviewer"|"trust_safety","profile_status": "active"|"suspended"|"deletion_pending","recruitment_preference": "local"|"international"|"both","report_category": "illegal_content"|"misleading_or_fraud"|"discrimination"|"fee_demanded_from_worker"|"harassment"|"privacy_violation"|"other","report_status": "new"|"in_review"|"actioned"|"dismissed","report_target_type": "job"|"company"|"profile"|"content"|"partner_profile"|"requirement"|"partner_response"|"candidate_submission","requirement_close_reason": "filled"|"cancelled"|"expired","requirement_status": "draft"|"open"|"paused"|"closed"|"filled","requirement_visibility": "private"|"job_order_marketplace","response_status": "submitted"|"updated"|"withdrawn"|"shortlisted"|"selected"|"declined","salary_period": "hour"|"month"|"year","submission_status": "awaiting_candidate"|"declined_by_candidate"|"expired"|"submitted"|"viewed"|"shortlisted"|"interview"|"offer"|"hired"|"rejected"|"withdrawn","worker_availability": "now"|"from_date"|"unavailable","worker_document_type": "cv"|"certificate","workforce_size_band": "1_49"|"50_249"|"250_999"|"1000_plus"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "account_kind": ["worker", "company"],"analytics_metric": ["profile_views"],"appeal_status": ["open", "upheld", "restored"],"application_status": ["applied", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"],"cefr_level": ["A1", "A2", "B1", "B2", "C1", "C2"],"consent_action": ["granted", "withdrawn"],"data_export_status": ["queued", "ready"],"direct_hiring_rule_value": ["allowed", "licensed_partner_required", "blocked"],"employment_type": ["full_time", "part_time", "contract", "temporary", "seasonal"],"fee_model": ["fee_per_hire", "percent_first_year_salary", "hourly_rate", "monthly_rate", "on_request"],"geography_scope": ["sources_from", "serves_market"],"invitation_status": ["invited", "viewed", "accepted", "declined", "responded", "withdrawn", "expired"],"job_moderation_state": ["visible", "hidden", "org_suspended"],"job_status": ["draft", "open", "paused", "closed", "filled"],"member_role": ["owner", "admin", "member"],"organization_status": ["active", "suspended"],"organization_type": ["employer", "recruitment_company", "staffing_company"],"partner_need": ["none", "recruitment", "staffing", "both"],"partner_review_status": ["onboarding", "pending_review", "info_requested", "listed", "re_review", "declined"],"partner_service_type": ["staffing", "temporary", "contract", "project", "permanent"],"platform_role": ["admin", "verification_reviewer", "trust_safety"],"profile_status": ["active", "suspended", "deletion_pending"],"recruitment_preference": ["local", "international", "both"],"report_category": ["illegal_content", "misleading_or_fraud", "discrimination", "fee_demanded_from_worker", "harassment", "privacy_violation", "other"],"report_status": ["new", "in_review", "actioned", "dismissed"],"report_target_type": ["job", "company", "profile", "content", "partner_profile", "requirement", "partner_response", "candidate_submission"],"requirement_close_reason": ["filled", "cancelled", "expired"],"requirement_status": ["draft", "open", "paused", "closed", "filled"],"requirement_visibility": ["private", "job_order_marketplace"],"response_status": ["submitted", "updated", "withdrawn", "shortlisted", "selected", "declined"],"salary_period": ["hour", "month", "year"],"submission_status": ["awaiting_candidate", "declined_by_candidate", "expired", "submitted", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"],"worker_availability": ["now", "from_date", "unavailable"],"worker_document_type": ["cv", "certificate"],"workforce_size_band": ["1_49", "50_249", "250_999", "1000_plus"]
          }
        }
} as const
