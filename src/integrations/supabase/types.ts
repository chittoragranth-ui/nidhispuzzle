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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      messages: {
        Row: {
          body: string
          created_at: string
          id: string
          nickname: string
          room_id: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          nickname: string
          room_id: string
          user_id?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          nickname?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          id: string
          joined_at: string
          last_seen: string
          nickname: string
          room_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          last_seen?: string
          nickname: string
          room_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          last_seen?: string
          nickname?: string
          room_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      pieces: {
        Row: {
          correct_x: number
          correct_y: number
          held_by: string | null
          held_until: string | null
          idx: number
          locked: boolean
          session_id: string
          version: number
          x: number
          y: number
        }
        Insert: {
          correct_x: number
          correct_y: number
          held_by?: string | null
          held_until?: string | null
          idx: number
          locked?: boolean
          session_id: string
          version?: number
          x: number
          y: number
        }
        Update: {
          correct_x?: number
          correct_y?: number
          held_by?: string | null
          held_until?: string | null
          idx?: number
          locked?: boolean
          session_id?: string
          version?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "pieces_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "puzzle_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      puzzle_sessions: {
        Row: {
          aspect: number
          cols: number
          completed_at: string | null
          id: string
          image_path: string
          room_id: string
          rows: number
          seed: number
          started_at: string
        }
        Insert: {
          aspect: number
          cols?: number
          completed_at?: string | null
          id?: string
          image_path: string
          room_id: string
          rows?: number
          seed: number
          started_at?: string
        }
        Update: {
          aspect?: number
          cols?: number
          completed_at?: string | null
          id?: string
          image_path?: string
          room_id?: string
          rows?: number
          seed?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "puzzle_sessions_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          created_at: string
          creator_id: string
          current_session_id: string | null
          expires_at: string
          id: string
          status: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          creator_id: string
          current_session_id?: string | null
          expires_at?: string
          id?: string
          status?: string
          token_hash: string
        }
        Update: {
          created_at?: string
          creator_id?: string
          current_session_id?: string | null
          expires_at?: string
          id?: string
          status?: string
          token_hash?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_invite: { Args: { _room: string; _token: string }; Returns: Json }
      create_room: { Args: { _nickname: string }; Returns: Json }
      create_session: {
        Args: {
          _aspect: number
          _image_path: string
          _positions: Json
          _room: string
          _seed: number
        }
        Returns: string
      }
      drop_piece: {
        Args: { _idx: number; _session: string; _x: number; _y: number }
        Returns: Json
      }
      grab_piece: { Args: { _idx: number; _session: string }; Returns: boolean }
      is_member: { Args: { _room: string }; Returns: boolean }
      join_room: {
        Args: { _nickname: string; _room: string; _token: string }
        Returns: string
      }
      revoke_invite: { Args: { _room: string }; Returns: undefined }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
