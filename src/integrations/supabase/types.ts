export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      analysis_jobs: {
        Row: {
          access_token: string | null
          created_at: string
          error: string | null
          id: string
          pasted_text: string | null
          result_json: Json | null
          status: string
          updated_at: string
          url: string
          user_email: string | null
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          error?: string | null
          id?: string
          pasted_text?: string | null
          result_json?: Json | null
          status?: string
          updated_at?: string
          url: string
          user_email?: string | null
        }
        Update: {
          access_token?: string | null
          created_at?: string
          error?: string | null
          id?: string
          pasted_text?: string | null
          result_json?: Json | null
          status?: string
          updated_at?: string
          url?: string
          user_email?: string | null
        }
        Relationships: []
      }
      buyer_pass_users: {
        Row: {
          activated_at: string
          created_at: string
          email: string
          expires_at: string | null
          id: string
          renewal_reminder_sent: boolean
          stripe_customer_id: string | null
          stripe_session_id: string | null
        }
        Insert: {
          activated_at?: string
          created_at?: string
          email: string
          expires_at?: string | null
          id?: string
          renewal_reminder_sent?: boolean
          stripe_customer_id?: string | null
          stripe_session_id?: string | null
        }
        Update: {
          activated_at?: string
          created_at?: string
          email?: string
          expires_at?: string | null
          id?: string
          renewal_reminder_sent?: boolean
          stripe_customer_id?: string | null
          stripe_session_id?: string | null
        }
        Relationships: []
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      error_logs: {
        Row: {
          created_at: string
          error_message: string | null
          error_stage: string | null
          id: string
          job_id: string | null
          listing_url: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          error_stage?: string | null
          id?: string
          job_id?: string | null
          listing_url?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          error_stage?: string | null
          id?: string
          job_id?: string | null
          listing_url?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      listing_cache: {
        Row: {
          fetched_at: string
          image_url: string | null
          text_content: string | null
          url: string
        }
        Insert: {
          fetched_at?: string
          image_url?: string | null
          text_content?: string | null
          url: string
        }
        Update: {
          fetched_at?: string
          image_url?: string | null
          text_content?: string | null
          url?: string
        }
        Relationships: []
      }
      property_data_cache: {
        Row: {
          data: Json
          fetched_at: string
          postcode: string
        }
        Insert: {
          data: Json
          fetched_at?: string
          postcode: string
        }
        Update: {
          data?: Json
          fetched_at?: string
          postcode?: string
        }
        Relationships: []
      }
      saved_analyses: {
        Row: {
          analysis_json: Json | null
          created_at: string
          id: string
          is_pinned: boolean
          listing_url: string | null
          pinned_at: string | null
          user_email: string
        }
        Insert: {
          analysis_json?: Json | null
          created_at?: string
          id?: string
          is_pinned?: boolean
          listing_url?: string | null
          pinned_at?: string | null
          user_email: string
        }
        Update: {
          analysis_json?: Json | null
          created_at?: string
          id?: string
          is_pinned?: boolean
          listing_url?: string | null
          pinned_at?: string | null
          user_email?: string
        }
        Relationships: []
      }
      shared_reports: {
        Row: {
          analysis_data: Json
          created_at: string
          id: string
          property_address: string | null
          token: string
        }
        Insert: {
          analysis_data: Json
          created_at?: string
          id?: string
          property_address?: string | null
          token?: string
        }
        Update: {
          analysis_data?: Json
          created_at?: string
          id?: string
          property_address?: string | null
          token?: string
        }
        Relationships: []
      }
      single_report_tokens: {
        Row: {
          analysis_json: Json | null
          created_at: string
          expires_at: string
          id: string
          listing_url: string | null
          stripe_session_id: string | null
          token: string
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          analysis_json?: Json | null
          created_at?: string
          expires_at?: string
          id?: string
          listing_url?: string | null
          stripe_session_id?: string | null
          token: string
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          analysis_json?: Json | null
          created_at?: string
          expires_at?: string
          id?: string
          listing_url?: string | null
          stripe_session_id?: string | null
          token?: string
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      buyer_pass_email_exists: { Args: { _email: string }; Returns: boolean }
      cleanup_old_analysis_jobs: { Args: never; Returns: undefined }
      cleanup_property_data_cache: { Args: never; Returns: undefined }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      get_single_report_token: {
        Args: { _token: string }
        Returns: {
          expires_at: string
          listing_url: string
          stripe_session_id: string
          token: string
        }[]
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
