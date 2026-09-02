/**
 * Generated from the live schema with the Supabase MCP `generate_typescript_types`
 * tool, then trimmed: the generated file ships ~200 lines of conditional-type
 * boilerplate for cross-schema lookups we never do. The `Database` type below is
 * verbatim; the helpers at the bottom are the single-schema equivalents.
 *
 * Regenerate after every migration.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: { PostgrestVersion: '14.5' };
  public: {
    Tables: {
      approval_tokens: {
        Row: {
          action: Database['public']['Enums']['token_action'];
          created_at: string;
          expires_at: string;
          id: string;
          request_id: string;
          revoked_at: string | null;
          token_hash: string;
          used_at: string | null;
          used_by_ip: unknown;
        };
        Insert: {
          action: Database['public']['Enums']['token_action'];
          created_at?: string;
          expires_at: string;
          id?: string;
          request_id: string;
          revoked_at?: string | null;
          token_hash: string;
          used_at?: string | null;
          used_by_ip?: unknown;
        };
        Update: Partial<Database['public']['Tables']['approval_tokens']['Insert']>;
        Relationships: [];
      };
      attachments: {
        Row: {
          created_at: string;
          file_name: string;
          id: string;
          mime_type: string;
          request_id: string;
          size_bytes: number;
          storage_key: string;
          uploaded_by: string | null;
        };
        Insert: {
          created_at?: string;
          file_name: string;
          id?: string;
          mime_type: string;
          request_id: string;
          size_bytes: number;
          storage_key: string;
          uploaded_by?: string | null;
        };
        Update: Partial<Database['public']['Tables']['attachments']['Insert']>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          actor_email: string | null;
          actor_id: string | null;
          channel: Database['public']['Enums']['decision_channel'] | null;
          created_at: string;
          event: string;
          id: number;
          metadata_json: Json;
          request_id: string | null;
        };
        Insert: {
          actor_email?: string | null;
          actor_id?: string | null;
          channel?: Database['public']['Enums']['decision_channel'] | null;
          created_at?: string;
          event: string;
          id?: never;
          metadata_json?: Json;
          request_id?: string | null;
        };
        Update: Partial<Database['public']['Tables']['audit_log']['Insert']>;
        Relationships: [];
      };
      booking_links: {
        Row: { created_at: string; id: string; position: number; request_id: string; url: string };
        Insert: {
          created_at?: string;
          id?: string;
          position?: number;
          request_id: string;
          url: string;
        };
        Update: Partial<Database['public']['Tables']['booking_links']['Insert']>;
        Relationships: [];
      };
      dev_inbound_bodies: {
        Row: {
          cc_emails: string[];
          created_at: string;
          fail_fetches_remaining: number;
          fetch_count: number;
          from_email: string;
          headers_json: Json;
          provider_email_id: string;
          raw_html: string | null;
          raw_text: string | null;
          subject: string | null;
          to_emails: string[];
        };
        Insert: {
          cc_emails?: string[];
          created_at?: string;
          fail_fetches_remaining?: number;
          fetch_count?: number;
          from_email: string;
          headers_json?: Json;
          provider_email_id: string;
          raw_html?: string | null;
          raw_text?: string | null;
          subject?: string | null;
          to_emails?: string[];
        };
        Update: Partial<Database['public']['Tables']['dev_inbound_bodies']['Insert']>;
        Relationships: [];
      };
      dev_sent_emails: {
        Row: {
          created_at: string;
          from_email: string;
          headers_json: Json;
          html: string | null;
          id: string;
          kind: Database['public']['Enums']['email_kind'] | null;
          message_id_header: string | null;
          reply_to: string | null;
          request_id: string | null;
          subject: string;
          text_body: string | null;
          to_email: string;
        };
        Insert: {
          created_at?: string;
          from_email: string;
          headers_json?: Json;
          html?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['email_kind'] | null;
          message_id_header?: string | null;
          reply_to?: string | null;
          request_id?: string | null;
          subject: string;
          text_body?: string | null;
          to_email: string;
        };
        Update: Partial<Database['public']['Tables']['dev_sent_emails']['Insert']>;
        Relationships: [];
      };
      email_events: {
        Row: {
          created_at: string;
          from_email: string | null;
          id: string;
          kind: Database['public']['Enums']['email_kind'] | null;
          message_id_header: string | null;
          payload_json: Json;
          provider_message_id: string | null;
          reply_to: string | null;
          request_id: string | null;
          subject: string | null;
          to_email: string | null;
          type: Database['public']['Enums']['email_event_type'];
        };
        Insert: {
          created_at?: string;
          from_email?: string | null;
          id?: string;
          kind?: Database['public']['Enums']['email_kind'] | null;
          message_id_header?: string | null;
          payload_json?: Json;
          provider_message_id?: string | null;
          reply_to?: string | null;
          request_id?: string | null;
          subject?: string | null;
          to_email?: string | null;
          type: Database['public']['Enums']['email_event_type'];
        };
        Update: Partial<Database['public']['Tables']['email_events']['Insert']>;
        Relationships: [];
      };
      expense_items: {
        Row: {
          amount: number;
          category: Database['public']['Enums']['expense_category'];
          created_at: string;
          currency: string;
          description: string | null;
          id: string;
          position: number;
          request_id: string;
        };
        Insert: {
          amount: number;
          category: Database['public']['Enums']['expense_category'];
          created_at?: string;
          currency?: string;
          description?: string | null;
          id?: string;
          position?: number;
          request_id: string;
        };
        Update: Partial<Database['public']['Tables']['expense_items']['Insert']>;
        Relationships: [];
      };
      inbound_emails: {
        Row: {
          cc_emails: string[];
          created_at: string;
          fetch_attempts: number;
          fetch_status: string;
          from_email: string | null;
          headers_json: Json | null;
          id: string;
          ignored_reason: string | null;
          in_reply_to: string | null;
          last_fetch_error: string | null;
          match_strategy: string | null;
          matched_request_id: string | null;
          message_id_header: string | null;
          next_attempt_at: string;
          parse_verdict: string | null;
          process_status: string;
          processed_at: string | null;
          provider_email_id: string | null;
          raw_html: string | null;
          raw_text: string | null;
          received_for: string | null;
          references_header: string | null;
          subject: string | null;
          svix_id: string;
          to_emails: string[];
          updated_at: string;
          webhook_payload: Json;
        };
        Insert: {
          cc_emails?: string[];
          created_at?: string;
          fetch_attempts?: number;
          fetch_status?: string;
          from_email?: string | null;
          headers_json?: Json | null;
          id?: string;
          ignored_reason?: string | null;
          in_reply_to?: string | null;
          last_fetch_error?: string | null;
          match_strategy?: string | null;
          matched_request_id?: string | null;
          message_id_header?: string | null;
          next_attempt_at?: string;
          parse_verdict?: string | null;
          process_status?: string;
          processed_at?: string | null;
          provider_email_id?: string | null;
          raw_html?: string | null;
          raw_text?: string | null;
          received_for?: string | null;
          references_header?: string | null;
          subject?: string | null;
          svix_id: string;
          to_emails?: string[];
          updated_at?: string;
          webhook_payload?: Json;
        };
        Update: Partial<Database['public']['Tables']['inbound_emails']['Insert']>;
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          full_name: string;
          id: string;
          manager_email: string | null;
          role: Database['public']['Enums']['app_role'];
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          full_name: string;
          id: string;
          manager_email?: string | null;
          role?: Database['public']['Enums']['app_role'];
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
      };
      projects: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['projects']['Insert']>;
        Relationships: [];
      };
      travel_requests: {
        Row: {
          approval_email_count: number;
          bill_to: Database['public']['Enums']['bill_to_type'] | null;
          bill_to_display: string | null;
          clarification_count: number;
          cloned_from_id: string | null;
          created_at: string;
          currency: string;
          decided_at: string | null;
          decided_by_email: string | null;
          decision_channel: Database['public']['Enums']['decision_channel'] | null;
          decision_reason: string | null;
          departure_date: string | null;
          expires_at: string | null;
          from_city: string | null;
          id: string;
          last_approval_email_at: string | null;
          manager_email: string | null;
          mode: Database['public']['Enums']['travel_mode'] | null;
          project_code: string | null;
          project_id: string | null;
          purpose: string | null;
          reminder_sent_at: string | null;
          reply_key: string;
          requester_id: string;
          return_date: string | null;
          status: Database['public']['Enums']['request_status'];
          submitted_at: string | null;
          to_city: string | null;
          total_amount: number;
          updated_at: string;
        };
        Insert: {
          approval_email_count?: number;
          bill_to?: Database['public']['Enums']['bill_to_type'] | null;
          /** Generated column — never write to it. */
          bill_to_display?: never;
          clarification_count?: number;
          cloned_from_id?: string | null;
          created_at?: string;
          currency?: string;
          decided_at?: string | null;
          decided_by_email?: string | null;
          decision_channel?: Database['public']['Enums']['decision_channel'] | null;
          decision_reason?: string | null;
          departure_date?: string | null;
          expires_at?: string | null;
          from_city?: string | null;
          id?: string;
          last_approval_email_at?: string | null;
          manager_email?: string | null;
          mode?: Database['public']['Enums']['travel_mode'] | null;
          project_code?: string | null;
          project_id?: string | null;
          purpose?: string | null;
          reminder_sent_at?: string | null;
          reply_key?: string;
          requester_id: string;
          return_date?: string | null;
          status?: Database['public']['Enums']['request_status'];
          submitted_at?: string | null;
          to_city?: string | null;
          /** Recomputed by a trigger from expense_items — writing it is pointless. */
          total_amount?: number;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['travel_requests']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: {
      can_view_request: { Args: { p_request_id: string }; Returns: boolean };
      dev_claim_inbound_fetch: {
        Args: { p_provider_email_id: string };
        Returns: { attempt: number; should_fail: boolean }[];
      };
      cancel_request: {
        Args: { p_actor_email: string; p_request_id: string };
        Returns: {
          applied: boolean;
          error_code: string;
          final_status: Database['public']['Enums']['request_status'];
        }[];
      };
      claim_due_reminders: { Args: { p_limit?: number }; Returns: string[] };
      consume_approval_token: {
        Args: { p_ip?: unknown; p_token_hash: string };
        Returns: {
          action: Database['public']['Enums']['token_action'];
          error_code: string;
          ok: boolean;
          request_id: string;
        }[];
      };
      current_app_role: { Args: never; Returns: Database['public']['Enums']['app_role'] };
      current_email: { Args: never; Returns: string };
      decide_request: {
        Args: {
          p_actor_email: string;
          p_channel: Database['public']['Enums']['decision_channel'];
          p_decision: Database['public']['Enums']['request_status'];
          p_reason?: string;
          p_request_id: string;
        };
        Returns: {
          applied: boolean;
          error_code: string;
          final_status: Database['public']['Enums']['request_status'];
        }[];
      };
      expire_due_requests: { Args: { p_limit?: number }; Returns: string[] };
      gen_reply_key: { Args: never; Returns: string };
      is_finance: { Args: never; Returns: boolean };
      submit_request: {
        Args: { p_actor_email: string; p_expiry_days?: number; p_request_id: string };
        Returns: { error_code: string; new_expires_at: string; ok: boolean }[];
      };
    };
    Enums: {
      app_role: 'REQUESTER' | 'MANAGER' | 'FINANCE' | 'ADMIN';
      bill_to_type: 'AWIGN' | 'PROJECT';
      decision_channel: 'EMAIL_REPLY' | 'LINK' | 'PORTAL' | 'SYSTEM';
      email_event_type:
        | 'SENT'
        | 'DELIVERED'
        | 'BOUNCED'
        | 'COMPLAINED'
        | 'DELIVERY_DELAYED'
        | 'SEND_FAILED'
        | 'INBOUND_REPLY'
        | 'INBOUND_IGNORED'
        | 'CLARIFICATION_SENT'
        | 'REMINDER_SENT'
        | 'NOTIFICATION_SENT';
      email_kind:
        | 'APPROVAL_REQUEST'
        | 'REMINDER'
        | 'CLARIFICATION'
        | 'DECISION_NOTICE'
        | 'EXPIRY_NOTICE';
      expense_category: 'TICKET' | 'ACCOMMODATION' | 'LOCAL_TRANSPORT' | 'MEALS' | 'OTHER';
      request_status:
        | 'DRAFT'
        | 'PENDING_APPROVAL'
        | 'APPROVED'
        | 'REJECTED'
        | 'CANCELLED'
        | 'EXPIRED';
      token_action: 'APPROVE' | 'REJECT';
      travel_mode: 'FLIGHT' | 'TRAIN' | 'BUS' | 'CAB' | 'OTHER';
    };
    CompositeTypes: Record<never, never>;
  };
};

type Public = Database['public'];

export type Tables<T extends keyof Public['Tables']> = Public['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Public['Tables']> = Public['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Public['Tables']> = Public['Tables'][T]['Update'];
export type Enums<T extends keyof Public['Enums']> = Public['Enums'][T];
export type FnArgs<T extends keyof Public['Functions']> = Public['Functions'][T]['Args'];
export type FnReturns<T extends keyof Public['Functions']> = Public['Functions'][T]['Returns'];

export const APP_ROLES = ['REQUESTER', 'MANAGER', 'FINANCE', 'ADMIN'] as const;
export const REQUEST_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
] as const;
export const TRAVEL_MODES = ['FLIGHT', 'TRAIN', 'BUS', 'CAB', 'OTHER'] as const;
export const EXPENSE_CATEGORIES = [
  'TICKET',
  'ACCOMMODATION',
  'LOCAL_TRANSPORT',
  'MEALS',
  'OTHER',
] as const;
export const BILL_TO_TYPES = ['AWIGN', 'PROJECT'] as const;
export const DECISION_CHANNELS = ['EMAIL_REPLY', 'LINK', 'PORTAL', 'SYSTEM'] as const;
