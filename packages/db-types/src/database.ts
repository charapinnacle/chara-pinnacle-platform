
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "consents": {
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
                    {
      foreignKeyName: "consents_purpose_version_fkey"
      columns: ["purpose","version"]
isOneToOne: false
      referencedRelation: "legal_documents"
      referencedColumns: ["slug","version"]
    }
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
      foreignKeyName: "organization_members_user_id_fkey"
      columns: ["user_id"]
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
                    "account_kind": Database["public"]['Enums']["account_kind"] | null,"created_at": string,"deleted_at": string | null,"display_name": string | null,"id": string,"intended_account_kind": Database["public"]['Enums']["account_kind"] | null,"pending_consents": NonNullable<Json>,"preferred_lang": string,"status": Database["public"]['Enums']["profile_status"]
                  }
                  Insert: {
                    "account_kind"?: Database["public"]['Enums']["account_kind"] | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id": string,"intended_account_kind"?: Database["public"]['Enums']["account_kind"] | null,"pending_consents"?: NonNullable<Json>,"preferred_lang"?: string,"status"?: Database["public"]['Enums']["profile_status"]
                  }
                  Update: {
                    "account_kind"?: Database["public"]['Enums']["account_kind"] | null,"created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id"?: string,"intended_account_kind"?: Database["public"]['Enums']["account_kind"] | null,"pending_consents"?: NonNullable<Json>,"preferred_lang"?: string,"status"?: Database["public"]['Enums']["profile_status"]
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
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_consents":
{ Args: { "p_consents": Json }; Returns: undefined
                           },
"accept_invitation":
{ Args: { "p_token": string }; Returns: string
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
"invite_member":
{ Args: { "p_email": string,"p_org": string,"p_role": Database["public"]['Enums']["member_role"] }; Returns: string
                           },
"list_organization_members":
{ Args: { "p_after_user"?: string,"p_limit"?: number,"p_org": string }; Returns: {
              "accepted_at": string,"mfa_enrolled": boolean,"role": Database["public"]['Enums']["member_role"],"user_id": string
            }[]
                           },
"list_platform_staff":
{ Args: { "p_after_id"?: number,"p_limit"?: number }; Returns: {
              "granted_at": string,"id": number,"mfa_enrolled": boolean,"role": Database["public"]['Enums']["platform_role"],"user_id": string
            }[]
                           },
"my_platform_roles":
{ Args: Record<PropertyKey, never>; Returns: Database["public"]['Enums']["platform_role"][]
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
"recovery_link_is_fresh":
{ Args: { "p_token_hash": string }; Returns: boolean
                           },
"remove_member":
{ Args: { "p_org": string,"p_user": string }; Returns: undefined
                           },
"reset_mfa":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: undefined
                           },
"set_account_kind":
{ Args: { "p_consents"?: Json }; Returns: Database["public"]['Enums']["account_kind"]
                           },
"set_legal_entity_identifier":
{ Args: { "p_identifier": string,"p_kind": string,"p_org": string }; Returns: undefined
                           },
"signup_documents":
{ Args: { "p_kind": Database["public"]['Enums']["account_kind"] }; Returns: {
              "change_summary": string,"published_at": string,"slug": string,"title": string,"version": number
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
            "account_kind": "worker"|"company","consent_action": "granted"|"withdrawn","member_role": "owner"|"admin"|"member","organization_status": "active"|"suspended","organization_type": "employer"|"recruitment_company"|"staffing_company","platform_role": "admin"|"verification_reviewer"|"trust_safety","profile_status": "active"|"suspended"|"deletion_pending"
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
            "account_kind": ["worker", "company"],"consent_action": ["granted", "withdrawn"],"member_role": ["owner", "admin", "member"],"organization_status": ["active", "suspended"],"organization_type": ["employer", "recruitment_company", "staffing_company"],"platform_role": ["admin", "verification_reviewer", "trust_safety"],"profile_status": ["active", "suspended", "deletion_pending"]
          }
        }
} as const
