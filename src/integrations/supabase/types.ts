export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string;
          actor_id: string | null;
          actor_name: string | null;
          created_at: string;
          detail: Json;
          entity: string;
          entity_ref: string | null;
          id: string;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          detail?: Json;
          entity: string;
          entity_ref?: string | null;
          id?: string;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          actor_name?: string | null;
          created_at?: string;
          detail?: Json;
          entity?: string;
          entity_ref?: string | null;
          id?: string;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          created_at: string;
          id: string;
          name: string | null;
          notes: string | null;
          phone: string | null;
          whatsapp_phone: string | null;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name?: string | null;
          notes?: string | null;
          phone?: string | null;
          whatsapp_phone?: string | null;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string | null;
          notes?: string | null;
          phone?: string | null;
          whatsapp_phone?: string | null;
        };
        Relationships: [];
      };
      fabrics: {
        Row: {
          category: string;
          code: string;
          colour: string | null;
          created_at: string;
          default_price_paise: number | null;
          design: string | null;
          id: string;
          name: string;
          width_mm: number | null;
        };
        Insert: {
          category?: string;
          code: string;
          colour?: string | null;
          created_at?: string;
          default_price_paise?: number | null;
          design?: string | null;
          id?: string;
          name: string;
          width_mm?: number | null;
        };
        Update: {
          category?: string;
          code?: string;
          colour?: string | null;
          created_at?: string;
          default_price_paise?: number | null;
          design?: string | null;
          id?: string;
          name?: string;
          width_mm?: number | null;
        };
        Relationships: [];
      };
      holds: {
        Row: {
          created_at: string;
          expires_at: string;
          id: string;
          length_mm: number;
          reference: string | null;
          status: string;
          thaan_id: string;
        };
        Insert: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          length_mm: number;
          reference?: string | null;
          status?: string;
          thaan_id: string;
        };
        Update: {
          created_at?: string;
          expires_at?: string;
          id?: string;
          length_mm?: number;
          reference?: string | null;
          status?: string;
          thaan_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "holds_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "holds_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "holds_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      listing_thaan_links: {
        Row: {
          listing_id: string;
          thaan_id: string;
        };
        Insert: {
          listing_id: string;
          thaan_id: string;
        };
        Update: {
          listing_id?: string;
          thaan_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_thaan_links_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_thaan_links_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "v_listing_availability";
            referencedColumns: ["listing_id"];
          },
          {
            foreignKeyName: "listing_thaan_links_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_thaan_links_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_thaan_links_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      listing_variants: {
        Row: {
          id: string;
          label: string;
          listing_id: string;
          qty: number;
        };
        Insert: {
          id?: string;
          label: string;
          listing_id: string;
          qty?: number;
        };
        Update: {
          id?: string;
          label?: string;
          listing_id?: string;
          qty?: number;
        };
        Relationships: [
          {
            foreignKeyName: "listing_variants_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_variants_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "v_listing_availability";
            referencedColumns: ["listing_id"];
          },
        ];
      };
      listings: {
        Row: {
          category: string | null;
          collection: string | null;
          created_at: string;
          description: string | null;
          id: string;
          images: string[];
          price_paise: number | null;
          published: boolean;
          sale_price_paise: number | null;
          seo_description: string | null;
          seo_title: string | null;
          slug: string;
          stock_mode: string;
          tags: string[];
          title: string;
        };
        Insert: {
          category?: string | null;
          collection?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          images?: string[];
          price_paise?: number | null;
          published?: boolean;
          sale_price_paise?: number | null;
          seo_description?: string | null;
          seo_title?: string | null;
          slug: string;
          stock_mode?: string;
          tags?: string[];
          title: string;
        };
        Update: {
          category?: string | null;
          collection?: string | null;
          created_at?: string;
          description?: string | null;
          id?: string;
          images?: string[];
          price_paise?: number | null;
          published?: boolean;
          sale_price_paise?: number | null;
          seo_description?: string | null;
          seo_title?: string | null;
          slug?: string;
          stock_mode?: string;
          tags?: string[];
          title?: string;
        };
        Relationships: [];
      };
      materials: {
        Row: {
          cost_paise: number | null;
          id: string;
          name: string;
          price_paise: number | null;
          qty_on_hand: number;
          unit: string;
        };
        Insert: {
          cost_paise?: number | null;
          id?: string;
          name: string;
          price_paise?: number | null;
          qty_on_hand?: number;
          unit?: string;
        };
        Update: {
          cost_paise?: number | null;
          id?: string;
          name?: string;
          price_paise?: number | null;
          qty_on_hand?: number;
          unit?: string;
        };
        Relationships: [];
      };
      online_orders: {
        Row: {
          amount_paise: number | null;
          created_at: string;
          customer_name: string;
          id: string;
          length_mm: number | null;
          listing_id: string | null;
          order_no: string;
          phone: string | null;
          qty: number | null;
          status: string;
        };
        Insert: {
          amount_paise?: number | null;
          created_at?: string;
          customer_name: string;
          id?: string;
          length_mm?: number | null;
          listing_id?: string | null;
          order_no: string;
          phone?: string | null;
          qty?: number | null;
          status?: string;
        };
        Update: {
          amount_paise?: number | null;
          created_at?: string;
          customer_name?: string;
          id?: string;
          length_mm?: number | null;
          listing_id?: string | null;
          order_no?: string;
          phone?: string | null;
          qty?: number | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "online_orders_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "online_orders_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "v_listing_availability";
            referencedColumns: ["listing_id"];
          },
        ];
      };
      permissions: {
        Row: {
          domain: string;
          key: string;
          label: string;
        };
        Insert: {
          domain: string;
          key: string;
          label: string;
        };
        Update: {
          domain?: string;
          key?: string;
          label?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          active: boolean;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          last_login: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          last_login?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          last_login?: string | null;
        };
        Relationships: [];
      };
      receiving_batches: {
        Row: {
          bill_no: string | null;
          code: string;
          committed_at: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          notes: string | null;
          received_on: string;
          status: string;
          supplier_id: string | null;
        };
        Insert: {
          bill_no?: string | null;
          code: string;
          committed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          received_on?: string;
          status?: string;
          supplier_id?: string | null;
        };
        Update: {
          bill_no?: string | null;
          code?: string;
          committed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          notes?: string | null;
          received_on?: string;
          status?: string;
          supplier_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "receiving_batches_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      role_permissions: {
        Row: {
          permission_key: string;
          role_key: string;
        };
        Insert: {
          permission_key: string;
          role_key: string;
        };
        Update: {
          permission_key?: string;
          role_key?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "role_permissions_role_key_fkey";
            columns: ["role_key"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["key"];
          },
        ];
      };
      roles: {
        Row: {
          description: string | null;
          key: string;
          label: string;
        };
        Insert: {
          description?: string | null;
          key: string;
          label: string;
        };
        Update: {
          description?: string | null;
          key?: string;
          label?: string;
        };
        Relationships: [];
      };
      sale_items: {
        Row: {
          amount_paise: number;
          id: string;
          length_mm: number;
          price_paise_per_m: number;
          sale_id: string;
          thaan_id: string | null;
        };
        Insert: {
          amount_paise: number;
          id?: string;
          length_mm: number;
          price_paise_per_m: number;
          sale_id: string;
          thaan_id?: string | null;
        };
        Update: {
          amount_paise?: number;
          id?: string;
          length_mm?: number;
          price_paise_per_m?: number;
          sale_id?: string;
          thaan_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sale_items_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      sales: {
        Row: {
          bill_no: string;
          created_at: string;
          customer_id: string | null;
          id: string;
          payment_mode: string;
          total_paise: number;
          user_id: string | null;
        };
        Insert: {
          bill_no: string;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          payment_mode?: string;
          total_paise?: number;
          user_id?: string | null;
        };
        Update: {
          bill_no?: string;
          created_at?: string;
          customer_id?: string | null;
          id?: string;
          payment_mode?: string;
          total_paise?: number;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_movements: {
        Row: {
          cost_snapshot_paise: number | null;
          created_at: string;
          delta_mm: number;
          id: string;
          job_id: string | null;
          kind: string;
          price_snapshot_paise: number | null;
          purpose: string | null;
          reason: string | null;
          reference: string | null;
          sale_id: string | null;
          thaan_id: string;
          user_id: string | null;
        };
        Insert: {
          cost_snapshot_paise?: number | null;
          created_at?: string;
          delta_mm: number;
          id?: string;
          job_id?: string | null;
          kind: string;
          price_snapshot_paise?: number | null;
          purpose?: string | null;
          reason?: string | null;
          reference?: string | null;
          sale_id?: string | null;
          thaan_id: string;
          user_id?: string | null;
        };
        Update: {
          cost_snapshot_paise?: number | null;
          created_at?: string;
          delta_mm?: number;
          id?: string;
          job_id?: string | null;
          kind?: string;
          price_snapshot_paise?: number | null;
          purpose?: string | null;
          reason?: string | null;
          reference?: string | null;
          sale_id?: string | null;
          thaan_id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_sale_id_fkey";
            columns: ["sale_id"];
            isOneToOne: false;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      suppliers: {
        Row: {
          city: string | null;
          id: string;
          name: string;
          phone: string | null;
        };
        Insert: {
          city?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
        };
        Update: {
          city?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      tailoring_job_lines: {
        Row: {
          category: string;
          cost_snapshot_paise: number | null;
          created_at: string;
          id: string;
          job_id: string;
          length_mm: number | null;
          material_id: string | null;
          price_snapshot_paise: number | null;
          qty: number | null;
          thaan_id: string | null;
        };
        Insert: {
          category?: string;
          cost_snapshot_paise?: number | null;
          created_at?: string;
          id?: string;
          job_id: string;
          length_mm?: number | null;
          material_id?: string | null;
          price_snapshot_paise?: number | null;
          qty?: number | null;
          thaan_id?: string | null;
        };
        Update: {
          category?: string;
          cost_snapshot_paise?: number | null;
          created_at?: string;
          id?: string;
          job_id?: string;
          length_mm?: number | null;
          material_id?: string | null;
          price_snapshot_paise?: number | null;
          qty?: number | null;
          thaan_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tailoring_job_lines_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailoring_job_lines_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailoring_job_lines_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailoring_job_lines_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailoring_job_lines_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      tailoring_jobs: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          garment: string;
          id: string;
          notes: string | null;
          status: string;
          tailor_id: string | null;
          tailor_name: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          garment: string;
          id?: string;
          notes?: string | null;
          status?: string;
          tailor_id?: string | null;
          tailor_name?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          garment?: string;
          id?: string;
          notes?: string | null;
          status?: string;
          tailor_id?: string | null;
          tailor_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tailoring_jobs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailoring_jobs_tailor_id_fkey";
            columns: ["tailor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      thaan_costs: {
        Row: {
          cost_paise: number;
          thaan_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          cost_paise: number;
          thaan_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          cost_paise?: number;
          thaan_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "thaan_costs_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thaan_costs_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thaan_costs_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      thaans: {
        Row: {
          barcode: string;
          batch_id: string | null;
          created_at: string;
          created_by: string | null;
          fabric_id: string | null;
          id: string;
          notes: string | null;
          original_mm: number | null;
          price_paise: number | null;
          rack: string | null;
          status: string;
          updated_at: string;
          width_mm: number | null;
        };
        Insert: {
          barcode: string;
          batch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          fabric_id?: string | null;
          id?: string;
          notes?: string | null;
          original_mm?: number | null;
          price_paise?: number | null;
          rack?: string | null;
          status?: string;
          updated_at?: string;
          width_mm?: number | null;
        };
        Update: {
          barcode?: string;
          batch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          fabric_id?: string | null;
          id?: string;
          notes?: string | null;
          original_mm?: number | null;
          price_paise?: number | null;
          rack?: string | null;
          status?: string;
          updated_at?: string;
          width_mm?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "thaans_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "receiving_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thaans_fabric_id_fkey";
            columns: ["fabric_id"];
            isOneToOne: false;
            referencedRelation: "fabrics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "thaans_fabric_id_fkey";
            columns: ["fabric_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["fabric_id"];
          },
        ];
      };
      user_permission_overrides: {
        Row: {
          granted: boolean;
          permission_key: string;
          user_id: string;
        };
        Insert: {
          granted: boolean;
          permission_key: string;
          user_id: string;
        };
        Update: {
          granted?: boolean;
          permission_key?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_permission_overrides_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role_key: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role_key: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role_key?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "user_roles_role_key_fkey";
            columns: ["role_key"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["key"];
          },
        ];
      };
      whatsapp_messages: {
        Row: {
          created_at: string;
          id: string;
          rendered_body: string;
          status: string;
          template_key: string | null;
          to_phone: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          rendered_body: string;
          status?: string;
          template_key?: string | null;
          to_phone: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          rendered_body?: string;
          status?: string;
          template_key?: string | null;
          to_phone?: string;
        };
        Relationships: [];
      };
      whatsapp_templates: {
        Row: {
          body: string;
          id: string;
          key: string;
          name: string;
          trigger_event: string | null;
        };
        Insert: {
          body: string;
          id?: string;
          key: string;
          name: string;
          trigger_event?: string | null;
        };
        Update: {
          body?: string;
          id?: string;
          key?: string;
          name?: string;
          trigger_event?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      v_listing_availability: {
        Row: {
          largest_piece_mm: number | null;
          linked_thaans: number | null;
          listing_id: string | null;
          total_linked_mm: number | null;
        };
        Relationships: [];
      };
      v_movement_log: {
        Row: {
          barcode: string | null;
          created_at: string | null;
          delta_mm: number | null;
          fabric_name: string | null;
          id: string | null;
          kind: string | null;
          price_snapshot_paise: number | null;
          purpose: string | null;
          reason: string | null;
          reference: string | null;
          user_id: string | null;
          user_name: string | null;
        };
        Relationships: [];
      };
      v_thaan_overview: {
        Row: {
          available_mm: number | null;
          barcode: string | null;
          batch_code: string | null;
          batch_id: string | null;
          category: string | null;
          colour: string | null;
          created_at: string | null;
          design: string | null;
          fabric_code: string | null;
          fabric_id: string | null;
          fabric_name: string | null;
          held_mm: number | null;
          id: string | null;
          is_incomplete: boolean | null;
          last_movement_at: string | null;
          original_mm: number | null;
          price_paise: number | null;
          rack: string | null;
          status: string | null;
          supplier_name: string | null;
          updated_at: string | null;
          width_mm: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "thaans_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "receiving_batches";
            referencedColumns: ["id"];
          },
        ];
      };
      v_thaan_stock: {
        Row: {
          available_mm: number | null;
          held_mm: number | null;
          thaan_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      finalize_production_cost: {
        Args: {
          p_request: string;
          p_job: string;
          p_expected_version: string | null;
          p_materials: Json;
          p_tailoring: number;
          p_design_basis: string;
          p_other: Json;
          p_reason: string;
        };
        Returns: string;
      };
      set_finished_product_sp: {
        Args: {
          p_request: string;
          p_job: string;
          p_cost_version: string;
          p_updates: Json;
          p_reason: string;
        };
        Returns: string;
      };
      owner_production_costs: { Args: { p_job: string }; Returns: Json };

      receive_finished_products: {
        Args: { p_request: string; p_job: string; p_pieces: Json; p_reason: string };
        Returns: string;
      };
      owner_erp_report: {
        Args: {
          p_dataset: string;
          p_from?: string;
          p_to?: string;
          p_after?: string;
          p_limit?: number;
          p_search?: string;
        };
        Returns: Json;
      };
      owner_erp_overview: { Args: { p_from?: string; p_to?: string }; Returns: Json };
      finished_product_sale_scan: { Args: { p_barcode: string }; Returns: Json };
      complete_finished_product_sale: {
        Args: {
          p_request: string;
          p_source: string;
          p_items: Json;
          p_customer: string | null;
          p_payment_confirmed: boolean;
          p_reference?: string;
        };
        Returns: string;
      };
      finished_product_order_history: {
        Args: { p_order?: string; p_limit?: number };
        Returns: Json;
      };
      finished_product_inventory: { Args: { p_after?: string; p_limit?: number }; Returns: Json };
      finished_product_movement_history: {
        Args: { p_piece?: string; p_limit?: number };
        Returns: Json;
      };
      transfer_finished_products: {
        Args: {
          p_request: string;
          p_source: string;
          p_destination: string;
          p_pieces: Json;
          p_reason: string;
        };
        Returns: string;
      };
      finished_product_catalog: {
        Args: { p_barcode?: string; p_job?: string; p_limit?: number };
        Returns: Json;
      };

      manage_production_catalog: {
        Args: {
          p_request: string;
          p_kind: string;
          p_id: string | null;
          p_code: string;
          p_name: string;
          p_active: boolean;
          p_charge_paise: number | null;
          p_reason: string;
        };
        Returns: string;
      };
      create_owner_production: {
        Args: {
          p_request: string;
          p_product: string;
          p_design: string;
          p_quantity: number;
          p_assignment: string;
          p_source: string;
          p_items: Json;
          p_notes: string | null;
          p_reason: string;
        };
        Returns: string;
      };
      progress_owner_production: {
        Args: {
          p_request: string;
          p_job: string;
          p_expected_status: string;
          p_status: string;
          p_reason: string;
        };
        Returns: string;
      };
      owner_production_catalog: { Args: Record<PropertyKey, never>; Returns: Json };
      owner_production_history: { Args: { p_job?: string; p_limit?: number }; Returns: Json };

      owner_tailoring_hierarchy: { Args: never; Returns: Json };
      tailoring_assignment_options: {
        Args: { p_factory?: string; p_section?: string; p_no_section?: boolean };
        Returns: Json;
      };
      manage_tailoring_entity: {
        Args: {
          p_request: string;
          p_kind: string;
          p_id: string | null;
          p_code: string;
          p_name: string;
          p_active: boolean;
          p_factory?: string | null;
          p_profile?: string | null;
          p_reason?: string;
        };
        Returns: string;
      };
      assign_tailor: {
        Args: {
          p_request: string;
          p_tailor: string;
          p_factory: string;
          p_section: string | null;
          p_expected_assignment: string | null;
          p_reason: string;
        };
        Returns: string;
      };
      consumable_catalog: { Args: never; Returns: Json };
      material_issue_jobs: { Args: never; Returns: Json };
      material_issue_history: { Args: { p_job?: string; p_limit?: number }; Returns: Json };
      consumable_receipt_history: { Args: { p_limit?: number }; Returns: Json };
      manage_consumable: {
        Args: { p_material: string; p_name: string; p_category: string; p_active: boolean };
        Returns: undefined;
      };
      receive_consumable: {
        Args: {
          p_request_id: string;
          p_material: string | null;
          p_name: string | null;
          p_unit: string | null;
          p_category: string | null;
          p_location: string;
          p_quantity: number;
          p_cp: number;
          p_reason: string;
        };
        Returns: string;
      };
      post_material_issue: {
        Args: {
          p_request_id: string;
          p_job_kind: string;
          p_job: string;
          p_source: string;
          p_type: string;
          p_items: Json;
          p_reason: string;
        };
        Returns: string;
      };
      setup_customer_tailoring_assignment: {
        Args: {
          p_factory_code: string;
          p_factory_name: string;
          p_section_code: string | null;
          p_section_name: string | null;
          p_tailor_code: string;
          p_tailor_name: string;
          p_profile?: string | null;
        };
        Returns: string;
      };
      set_customer_tailoring_charge: {
        Args: { p_code: string; p_name: string; p_amount: number };
        Returns: string;
      };
      customer_tailoring_catalog: { Args: never; Returns: Json };
      quote_customer_tailoring: {
        Args: { p_source: string; p_items: Json; p_charge: string };
        Returns: Json;
      };
      create_customer_tailoring: {
        Args: {
          p_request: string;
          p_quote: string;
          p_customer: string;
          p_assignment: string;
          p_garment: string;
          p_notes?: string;
        };
        Returns: string;
      };
      set_customer_tailoring_status: {
        Args: { p_job: string; p_status: string };
        Returns: undefined;
      };
      customer_tailoring_history: { Args: { p_job?: string; p_limit?: number }; Returns: Json };
      owner_customer_tailoring_costs: { Args: { p_job: string }; Returns: Json };
      direct_fabric_sale_catalog: { Args: { p_barcode?: string }; Returns: Json };
      complete_direct_fabric_sale: {
        Args: {
          p_request_id: string;
          p_source: string;
          p_items: Json;
          p_customer: string | null;
          p_payment_confirmed: boolean;
          p_reference?: string;
        };
        Returns: string;
      };
      direct_fabric_order_history: { Args: { p_order?: string; p_limit?: number }; Returns: Json };
      owner_direct_fabric_order_costs: { Args: { p_order: string }; Returns: Json };
      stock_transfer_history: { Args: { p_stock?: string; p_limit?: number }; Returns: Json };
      fabric_stock_catalog: { Args: { p_barcode?: string }; Returns: Json };
      fabric_stock_history: { Args: { p_stock: string }; Returns: Json };
      create_fabric_entry: {
        Args: {
          p_request_id: string;
          p_fabric: string;
          p_batch: string;
          p_lengths: Json;
          p_cp: number;
        };
        Returns: string;
      };
      update_fabric_entry: {
        Args: { p_stock: string; p_lengths: Json; p_cp: number };
        Returns: undefined;
      };
      complete_fabric_entry: { Args: { p_stock: string }; Returns: string };
      open_fabric_cp_correction: {
        Args: { p_stock: string; p_reason: string };
        Returns: undefined;
      };
      owner_set_fabric_sp: {
        Args: { p_stock: string; p_sp: number; p_reason: string };
        Returns: number;
      };
      domain_stock_entry_cp: {
        Args: { p_stock_id: string; p_cp?: number };
        Returns: number | null;
      };
      inventory_catalog: {
        Args: never;
        Returns: {
          item_kind: string;
          item_id: string;
          inventory_item_id: string | null;
          label: string;
          unit: string;
          quantity: number;
          unlinked_movements: number;
        }[];
      };
      inventory_locations: {
        Args: never;
        Returns: {
          id: string;
          code: string;
          name: string;
          kind: string;
          parent_id: string | null;
          active: boolean;
        }[];
      };
      inventory_location_balances: {
        Args: never;
        Returns: {
          inventory_item_id: string;
          location_id: string;
          unit: string;
          quantity: number;
        }[];
      };
      inventory_movement_history: {
        Args: { p_limit?: number };
        Returns: {
          id: string;
          inventory_item_id: string | null;
          kind: string;
          quantity: number;
          unit: string;
          source_location_id: string | null;
          destination_location_id: string | null;
          reference: string | null;
          reason: string | null;
          actor_id: string | null;
          occurred_at: string;
          customer_tailoring_job_id: string | null;
          production_job_id: string | null;
          order_item_id: string | null;
          stock_transfer_line_id: string | null;
        }[];
      };
      manage_showroom_location: {
        Args: { p_id: string | null; p_code: string; p_name: string; p_active?: boolean };
        Returns: string;
      };
      reconcile_inventory_item: {
        Args: { p_kind: string; p_item_id: string; p_allocations: Json; p_reason: string };
        Returns: string;
      };
      post_inventory_transfer: {
        Args: {
          p_request_id: string;
          p_source: string;
          p_destination: string;
          p_items: Json;
          p_reason: string;
        };
        Returns: string;
      };
      record_inventory_correction: {
        Args: {
          p_item: string;
          p_location: string;
          p_kind: string;
          p_quantity: number;
          p_incoming: boolean;
          p_reason: string;
        };
        Returns: string;
      };
      material_available_qty: {
        Args: { p_material: string };
        Returns: number;
      };
      owner_tailoring_line_prices: {
        Args: never;
        Returns: { line_id: string; price_snapshot_paise: number | null }[];
      };
      stock_entry_cp: {
        Args: { p_thaan_id: string };
        Returns: number;
      };
      stock_entry_set_cp: {
        Args: { p_thaan_id: string; p_cost_paise: number };
        Returns: undefined;
      };
      active_tailors: {
        Args: never;
        Returns: {
          email: string | null;
          full_name: string;
          id: string;
        }[];
      };
      adjust_thaan: {
        Args: {
          p_delta_mm: number;
          p_kind: string;
          p_reason: string;
          p_thaan_id: string;
        };
        Returns: undefined;
      };
      bootstrap_current_user: { Args: { _full_name?: string }; Returns: Json };
      commit_receiving_batch: { Args: { p_batch_id: string }; Returns: Json };
      complete_fabric_sale: {
        Args: {
          p_customer_id?: string;
          p_items: Json;
          p_reason?: string;
        };
        Returns: Json;
      };
      create_tailoring_job: {
        Args: {
          p_customer_id?: string;
          p_garment: string;
          p_notes?: string;
          p_tailor_id: string;
        };
        Returns: string;
      };
      correct_incomplete_thaan: {
        Args: {
          p_cost_paise?: number;
          p_fabric_id?: string;
          p_original_mm?: number;
          p_price_paise?: number;
          p_thaan_id: string;
          p_width_mm?: number;
        };
        Returns: Json;
      };
      cut_thaan: {
        Args: {
          p_barcode: string;
          p_category?: string;
          p_customer_id?: string;
          p_job_id?: string;
          p_length_mm: number;
          p_purpose?: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      find_or_create_customer: {
        Args: {
          p_name?: string;
          p_notes?: string;
          p_phone?: string;
          p_whatsapp_phone?: string;
        };
        Returns: string | null;
      };
      dashboard_metrics: { Args: never; Returns: Json };
      eligible_tailoring_jobs: {
        Args: never;
        Returns: {
          code: string;
          garment: string;
          id: string;
          status: string;
          tailor_email: string | null;
          tailor_id: string;
          tailor_name: string;
        }[];
      };
      has_any_perm: {
        Args: { _perms: string[]; _user_id: string };
        Returns: boolean;
      };
      has_any_role: {
        Args: { _roles: string[]; _user_id: string };
        Returns: boolean;
      };
      has_perm: { Args: { _perm: string; _user_id: string }; Returns: boolean };
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean };
      is_active_staff: { Args: { _user_id: string }; Returns: boolean };
      issue_tailoring_fabrics: {
        Args: {
          p_items: Json;
          p_job_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      log_audit: {
        Args: { _action: string; _detail: Json; _entity: string; _ref: string };
        Returns: undefined;
      };
      material_costs: {
        Args: never;
        Returns: {
          cost_paise: number;
          material_id: string;
        }[];
      };
      place_hold: {
        Args: {
          p_length_mm: number;
          p_minutes?: number;
          p_reference?: string;
          p_thaan_id: string;
        };
        Returns: string;
      };
      release_hold: { Args: { p_hold_id: string }; Returns: undefined };
      assign_tailoring_job: {
        Args: { p_job_id: string; p_tailor_id: string };
        Returns: undefined;
      };
      tailoring_job_totals: {
        Args: never;
        Returns: {
          fabric_cost_paise: number;
          job_id: string;
          lines: number;
          selling_value_paise: number;
        }[];
      };
      tailoring_line_costs: {
        Args: never;
        Returns: {
          cost_snapshot_paise: number;
          line_id: string;
        }[];
      };
      thaan_available_mm: { Args: { p_thaan: string }; Returns: number };
      update_tailoring_job_status: {
        Args: { p_job_id: string; p_status: string };
        Returns: undefined;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
