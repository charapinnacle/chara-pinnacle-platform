
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "application_events": {
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
                    "accommodation": boolean,"city": string,"country_code": string,"created_at": string,"created_by": string | null,"deleted_at": string | null,"description": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"industry_code": string,"moderation_state": Database["public"]['Enums']["job_moderation_state"],"occupation_id": string,"organization_id": string,"posted_on_behalf_of_organization_id": string | null,"published_at": string | null,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency": string | null,"salary_max": number | null,"salary_min": number | null,"salary_period": Database["public"]['Enums']["salary_period"] | null,"search_vector": unknown,"status": Database["public"]['Enums']["job_status"],"status_changed_at": string,"title": string,"visa_support": boolean
                  }
                  Insert: {
                    "accommodation"?: boolean,"city": string,"country_code": string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description": string,"employment_type": Database["public"]['Enums']["employment_type"],"id"?: string,"industry_code": string,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"occupation_id": string,"organization_id": string,"posted_on_behalf_of_organization_id"?: string | null,"published_at"?: string | null,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency"?: string | null,"salary_max"?: number | null,"salary_min"?: number | null,"salary_period"?: Database["public"]['Enums']["salary_period"] | null,"search_vector"?: never,"status"?: Database["public"]['Enums']["job_status"],"status_changed_at"?: string,"title": string,"visa_support"?: boolean
                  }
                  Update: {
                    "accommodation"?: boolean,"city"?: string,"country_code"?: string,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"description"?: string,"employment_type"?: Database["public"]['Enums']["employment_type"],"id"?: string,"industry_code"?: string,"moderation_state"?: Database["public"]['Enums']["job_moderation_state"],"occupation_id"?: string,"organization_id"?: string,"posted_on_behalf_of_organization_id"?: string | null,"published_at"?: string | null,"recruitment_preference"?: Database["public"]['Enums']["recruitment_preference"],"salary_currency"?: string | null,"salary_max"?: number | null,"salary_min"?: number | null,"salary_period"?: Database["public"]['Enums']["salary_period"] | null,"search_vector"?: never,"status"?: Database["public"]['Enums']["job_status"],"status_changed_at"?: string,"title"?: string,"visa_support"?: boolean
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
                    "body": string,"change_summary": string,"published_at": string | null,"slug": string,"title": string,"version": number
                  }
                  Insert: {
                    "body": string,"change_summary": string,"published_at"?: string | null,"slug": string,"title": string,"version": number
                  }
                  Update: {
                    "body"?: string,"change_summary"?: string,"published_at"?: string | null,"slug"?: string,"title"?: string,"version"?: number
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
                },"organizations": {
                  Row: {
                    "based_in_country": string,"created_at": string,"display_name": string,"id": string,"industry_code": string | null,"legal_entity_identifier": string | null,"legal_entity_identifier_kind": string | null,"legal_name": string,"slug": string,"status": Database["public"]['Enums']["organization_status"],"type": Database["public"]['Enums']["organization_type"],"website": string | null
                  }
                  Insert: {
                    "based_in_country": string,"created_at"?: string,"display_name": string,"id"?: string,"industry_code"?: string | null,"legal_entity_identifier"?: string | null,"legal_entity_identifier_kind"?: string | null,"legal_name": string,"slug": string,"status"?: Database["public"]['Enums']["organization_status"],"type": Database["public"]['Enums']["organization_type"],"website"?: string | null
                  }
                  Update: {
                    "based_in_country"?: string,"created_at"?: string,"display_name"?: string,"id"?: string,"industry_code"?: string | null,"legal_entity_identifier"?: string | null,"legal_entity_identifier_kind"?: string | null,"legal_name"?: string,"slug"?: string,"status"?: Database["public"]['Enums']["organization_status"],"type"?: Database["public"]['Enums']["organization_type"],"website"?: string | null
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
                },"passport_shares": {
                  Row: {
                    "application_id": string,"consent_id": number,"created_at": string,"expires_at": string | null,"id": string,"organization_id": string,"revoked_at": string | null,"scope": NonNullable<Json>,"worker_user_id": string
                  }
                  Insert: {
                    "application_id": string,"consent_id": number,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"organization_id": string,"revoked_at"?: string | null,"scope": NonNullable<Json>,"worker_user_id": string
                  }
                  Update: {
                    "application_id"?: string,"consent_id"?: number,"created_at"?: string,"expires_at"?: string | null,"id"?: string,"organization_id"?: string,"revoked_at"?: string | null,"scope"?: NonNullable<Json>,"worker_user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "passport_shares_application_id_fkey"
      columns: ["application_id"]
isOneToOne: false
      referencedRelation: "job_applications"
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
                    "account_kind": Database["public"]['Enums']["account_kind"] | null,"created_at": string,"deleted_at": string | null,"display_name": string | null,"id": string,"intended_account_kind": Database["public"]['Enums']["account_kind"] | null,"legal_hold": boolean,"pending_consents": NonNullable<Json>,"preferred_lang": string,"status": Database["public"]['Enums']["profile_status"]
                  }
                  Insert: {
                    "account_kind"?: Database["public"]['Enums']["account_kind"] | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id": string,"intended_account_kind"?: Database["public"]['Enums']["account_kind"] | null,"legal_hold"?: boolean,"pending_consents"?: NonNullable<Json>,"preferred_lang"?: string,"status"?: Database["public"]['Enums']["profile_status"]
                  }
                  Update: {
                    "account_kind"?: Database["public"]['Enums']["account_kind"] | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id"?: string,"intended_account_kind"?: Database["public"]['Enums']["account_kind"] | null,"legal_hold"?: boolean,"pending_consents"?: NonNullable<Json>,"preferred_lang"?: string,"status"?: Database["public"]['Enums']["profile_status"]
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
                }
          }
          Views: {
            "v_my_document_access_log": {
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
                },"v_org_limits": {
                  Row: {
                    "active_jobs_limit": number | null,"open_jobs": number | null,"organization_id": string | null,"plan_name": string | null
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
                }
          }
          Functions: {
            "accept_consents":
{ Args: { "p_consents": Json }; Returns: undefined
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
"bulk_set_application_status":
{ Args: { "p_application_ids": (string)[],"p_note"?: string,"p_status": Database["public"]['Enums']["application_status"] }; Returns: {
              "application_id": string,"error_code": string,"ok": boolean
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
{ Args: { "p_consents"?: Json,"p_kind": Database["public"]['Enums']["account_kind"] }; Returns: Database["public"]['Enums']["account_kind"]
                           },
"create_organization":
{ Args: { "p_based_in_country": string,"p_display_name": string,"p_identifier"?: string,"p_identifier_kind"?: string,"p_industry_code": string,"p_legal_name": string,"p_type": Database["public"]['Enums']["organization_type"],"p_website"?: string }; Returns: Json
                           },
"create_worker_passport":
{ Args: { "p_current_country": string,"p_first_name": string,"p_last_name": string,"p_preferred_lang"?: string }; Returns: undefined
                           },
"delete_worker_document":
{ Args: { "p_document_id": string }; Returns: undefined
                           },
"document_access_grant":
{ Args: { "p_document_id": string,"p_purpose": string }; Returns: {
              "bucket_id": string,"file_name": string,"object_path": string
            }[]
                           },
"document_set_scan_status":
{ Args: { "p_document_id": string,"p_mime": string,"p_path": string,"p_size": number,"p_status": string }; Returns: string
                           },
"erase_user":
{ Args: { "p_user_id": string }; Returns: boolean
                           },
"get_applicant":
{ Args: { "p_application_id": string }; Returns: {
              "applicant_name": string,"applied_at": string,"id": string,"job_id": string,"job_title": string,"note_max_chars": number,"shortlisting_available": boolean,"stage_change_blocked": string,"status": Database["public"]['Enums']["application_status"]
            }[]
                           },
"get_my_application":
{ Args: { "p_id": string }; Returns: {
              "applied_at": string,"cover_note": string,"employer_display_name": string,"id": string,"job_id": string,"job_title": string,"status": Database["public"]['Enums']["application_status"],"vacancy_is_open": boolean
            }[]
                           },
"get_public_job":
{ Args: { "p_id": string }; Returns: {
              "accommodation": boolean,"city": string,"country": string,"country_code": string,"description": string,"employer_country": string,"employer_display_name": string,"employer_industry": string,"employer_website": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"industry": string,"occupation": string,"published_at": string,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency": string,"salary_max": number,"salary_min": number,"salary_period": Database["public"]['Enums']["salary_period"],"title": string,"visa_support": boolean
            }[]
                           },
"grant_platform_role":
{ Args: { "p_reason": string,"p_role": string,"p_user_id": string }; Returns: undefined
                           },
"invitation_preview":
{ Args: { "p_token": string }; Returns: {
              "email": string,"expires_at": string,"organization_name": string,"role": Database["public"]['Enums']["member_role"]
            }[]
                           },
"invite_member":
{ Args: { "p_email": string,"p_org": string,"p_role": string }; Returns: {
              "expires_at": string,"token": string
            }[]
                           },
"list_applicant_events":
{ Args: { "p_application_id": string }; Returns: {
              "actor_kind": string,"actor_name": string,"created_at": string,"from_status": Database["public"]['Enums']["application_status"],"id": number,"note": string,"to_status": Database["public"]['Enums']["application_status"]
            }[]
                           },
"list_my_applications":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "applied_at": string,"employer_display_name": string,"id": string,"job_id": string,"job_title": string,"next_cursor": string,"status": Database["public"]['Enums']["application_status"]
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
"list_platform_staff":
{ Args: { "p_after_id"?: number,"p_limit"?: number }; Returns: {
              "granted_at": string,"id": number,"mfa_enrolled": boolean,"role": Database["public"]['Enums']["platform_role"],"user_id": string
            }[]
                           },
"list_saved_jobs":
{ Args: { "p_cursor"?: string,"p_limit"?: number }; Returns: {
              "available": boolean,"employer_display_name": string,"job_id": string,"next_cursor": string,"saved_at": string,"status": Database["public"]['Enums']["job_status"],"title": string
            }[]
                           },
"mark_application_viewed":
{ Args: { "p_application_id": string }; Returns: undefined
                           },
"my_platform_roles":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["platform_role"][]
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
"rate_limit_attempt":
{ Args: { "p_action": string,"p_key": string }; Returns: {
              "allowed": boolean,"retry_after_seconds": number
            }[]
                           },
"record_job_form_invalid":
{ Args: { "p_fields": (string)[],"p_org": string }; Returns: undefined
                           },
"record_job_limit_prompt":
{ Args: { "p_org": string }; Returns: undefined
                           },
"recovery_link_is_fresh":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"remove_member":
{ Args: { "p_org": string,"p_user": string }; Returns: undefined
                           },
"request_account_deletion":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"reset_mfa":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"revoke_platform_role":
{ Args: { "p_reason": string,"p_role": string,"p_user_id": string }; Returns: undefined
                           },
"search_jobs":
{ Args: { "p_accommodation"?: boolean,"p_city"?: string,"p_country"?: string,"p_cursor"?: string,"p_employment_type"?: Database["public"]['Enums']["employment_type"],"p_industry"?: string,"p_limit"?: number,"p_occupation"?: string,"p_q"?: string,"p_recruitment"?: Database["public"]['Enums']["recruitment_preference"],"p_salary_currency"?: string,"p_salary_min"?: number,"p_salary_period"?: Database["public"]['Enums']["salary_period"],"p_visa_support"?: boolean }; Returns: {
              "accommodation": boolean,"city": string,"country_code": string,"created_at": string,"employer_display_name": string,"employer_slug": string,"employment_type": Database["public"]['Enums']["employment_type"],"id": string,"next_cursor": string,"recruitment_preference": Database["public"]['Enums']["recruitment_preference"],"salary_currency": string,"salary_max": number,"salary_min": number,"salary_period": Database["public"]['Enums']["salary_period"],"title": string,"visa_support": boolean
            }[]
                           },
"set_account_kind":
{ Args: { "p_consents"?: Json }; Returns: Database["public"]['Enums']["account_kind"]
                           },
"set_application_status":
{ Args: { "p_application_id": string,"p_note"?: string,"p_status": Database["public"]['Enums']["application_status"] }; Returns: undefined
                           },
"set_legal_entity_identifier":
{ Args: { "p_identifier": string,"p_kind": string,"p_org": string }; Returns: undefined
                           },
"signup_documents":
{ Args: { "p_kind": Database["public"]['Enums']["account_kind"] }; Returns: {
              "change_summary": string,"published_at": string,"slug": string,"title": string,"version": number
            }[]
                           },
"team_member_allowance":
{ Args: { "p_org": string }; Returns: {
              "member_limit": number,"used": number
            }[]
                           },
"transfer_ownership":
{ Args: { "p_new_owner": string,"p_org": string }; Returns: undefined
                           },
"withdraw_consent":
{ Args: { "p_purpose": string }; Returns: undefined
                           }
          }
          Enums: {
            "account_kind": "worker"|"company","application_status": "applied"|"viewed"|"shortlisted"|"interview"|"offer"|"hired"|"rejected"|"withdrawn","cefr_level": "A1"|"A2"|"B1"|"B2"|"C1"|"C2","consent_action": "granted"|"withdrawn","employment_type": "full_time"|"part_time"|"contract"|"temporary"|"seasonal","job_moderation_state": "visible"|"hidden"|"org_suspended","job_status": "draft"|"open"|"paused"|"closed"|"filled","member_role": "owner"|"admin"|"member","organization_status": "active"|"suspended","organization_type": "employer"|"recruitment_company"|"staffing_company","platform_role": "admin"|"verification_reviewer"|"trust_safety","profile_status": "active"|"suspended"|"deletion_pending","recruitment_preference": "local"|"international"|"both","salary_period": "hour"|"month"|"year","worker_availability": "now"|"from_date"|"unavailable","worker_document_type": "cv"|"certificate"
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
            "account_kind": ["worker", "company"],"application_status": ["applied", "viewed", "shortlisted", "interview", "offer", "hired", "rejected", "withdrawn"],"cefr_level": ["A1", "A2", "B1", "B2", "C1", "C2"],"consent_action": ["granted", "withdrawn"],"employment_type": ["full_time", "part_time", "contract", "temporary", "seasonal"],"job_moderation_state": ["visible", "hidden", "org_suspended"],"job_status": ["draft", "open", "paused", "closed", "filled"],"member_role": ["owner", "admin", "member"],"organization_status": ["active", "suspended"],"organization_type": ["employer", "recruitment_company", "staffing_company"],"platform_role": ["admin", "verification_reviewer", "trust_safety"],"profile_status": ["active", "suspended", "deletion_pending"],"recruitment_preference": ["local", "international", "both"],"salary_period": ["hour", "month", "year"],"worker_availability": ["now", "from_date", "unavailable"],"worker_document_type": ["cv", "certificate"]
          }
        }
} as const
