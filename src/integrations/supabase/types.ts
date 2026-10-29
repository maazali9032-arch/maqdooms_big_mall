export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
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
      barcode_identity_bindings: {
        Row: {
          bound_at: string;
          code: string;
          record_id: string;
          record_table: string;
        };
        Insert: {
          bound_at?: string;
          code: string;
          record_id: string;
          record_table: string;
        };
        Update: {
          bound_at?: string;
          code?: string;
          record_id?: string;
          record_table?: string;
        };
        Relationships: [
          {
            foreignKeyName: "barcode_identity_bindings_code_fkey";
            columns: ["code"];
            isOneToOne: true;
            referencedRelation: "barcode_identity_reservations";
            referencedColumns: ["code"];
          },
        ];
      };
      barcode_identity_reservations: {
        Row: {
          code: string;
          reserved_at: string;
        };
        Insert: {
          code: string;
          reserved_at?: string;
        };
        Update: {
          code?: string;
          reserved_at?: string;
        };
        Relationships: [];
      };
      barcodes: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          kind: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          kind?: string;
        };
        Relationships: [
          {
            foreignKeyName: "barcodes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      consumable_receipt_costs: {
        Row: {
          cp_paise_per_unit: number;
          receipt_id: string;
        };
        Insert: {
          cp_paise_per_unit: number;
          receipt_id: string;
        };
        Update: {
          cp_paise_per_unit?: number;
          receipt_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consumable_receipt_costs_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: true;
            referencedRelation: "consumable_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      consumable_receipts: {
        Row: {
          destination_location_id: string;
          id: string;
          inventory_item_id: string;
          material_id: string;
          quantity: number;
          reason: string;
          received_at: string;
          received_by: string;
          request_id: string;
          request_payload: Json;
          unit: string;
        };
        Insert: {
          destination_location_id: string;
          id?: string;
          inventory_item_id: string;
          material_id: string;
          quantity: number;
          reason: string;
          received_at?: string;
          received_by: string;
          request_id: string;
          request_payload: Json;
          unit: string;
        };
        Update: {
          destination_location_id?: string;
          id?: string;
          inventory_item_id?: string;
          material_id?: string;
          quantity?: number;
          reason?: string;
          received_at?: string;
          received_by?: string;
          request_id?: string;
          request_payload?: Json;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consumable_receipts_destination_location_id_fkey";
            columns: ["destination_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consumable_receipts_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consumable_receipts_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "v_inventory_location_balances";
            referencedColumns: ["inventory_item_id"];
          },
          {
            foreignKeyName: "consumable_receipts_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consumable_receipts_received_by_fkey";
            columns: ["received_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      counter_bill_discount_revisions: {
        Row: {
          bill_id: string;
          created_at: string;
          discount_bps: number;
          discount_paise: number;
          document: Json;
          final_paise: number;
          gross_paise: number;
          id: string;
          revised_by: string;
          revision_no: number;
        };
        Insert: {
          bill_id: string;
          created_at?: string;
          discount_bps: number;
          discount_paise: number;
          document: Json;
          final_paise: number;
          gross_paise: number;
          id?: string;
          revised_by: string;
          revision_no: number;
        };
        Update: {
          bill_id?: string;
          created_at?: string;
          discount_bps?: number;
          discount_paise?: number;
          document?: Json;
          final_paise?: number;
          gross_paise?: number;
          id?: string;
          revised_by?: string;
          revision_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: "counter_bill_discount_revisions_bill_id_fkey";
            columns: ["bill_id"];
            isOneToOne: false;
            referencedRelation: "counter_bills";
            referencedColumns: ["order_id"];
          },
          {
            foreignKeyName: "counter_bill_discount_revisions_revised_by_fkey";
            columns: ["revised_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      counter_bill_payments: {
        Row: {
          actor_id: string;
          amount_paise: number;
          bill_id: string;
          id: string;
          paid_at: string;
          request_id: string;
        };
        Insert: {
          actor_id: string;
          amount_paise: number;
          bill_id: string;
          id?: string;
          paid_at?: string;
          request_id: string;
        };
        Update: {
          actor_id?: string;
          amount_paise?: number;
          bill_id?: string;
          id?: string;
          paid_at?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "counter_bill_payments_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "counter_bill_payments_bill_id_fkey";
            columns: ["bill_id"];
            isOneToOne: false;
            referencedRelation: "counter_bills";
            referencedColumns: ["order_id"];
          },
        ];
      };
      counter_bill_print_records: {
        Row: {
          bill_id: string;
          document: Json;
          recorded_at: string;
        };
        Insert: {
          bill_id: string;
          document: Json;
          recorded_at?: string;
        };
        Update: {
          bill_id?: string;
          document?: Json;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "counter_bill_print_records_bill_id_fkey";
            columns: ["bill_id"];
            isOneToOne: true;
            referencedRelation: "counter_bills";
            referencedColumns: ["order_id"];
          },
        ];
      };
      counter_bill_terminal_records: {
        Row: {
          bill_id: string;
          recorded_at: string;
          terminal_id: string | null;
        };
        Insert: {
          bill_id: string;
          recorded_at?: string;
          terminal_id?: string | null;
        };
        Update: {
          bill_id?: string;
          recorded_at?: string;
          terminal_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "counter_bill_terminal_records_bill_id_fkey";
            columns: ["bill_id"];
            isOneToOne: true;
            referencedRelation: "counter_bills";
            referencedColumns: ["order_id"];
          },
          {
            foreignKeyName: "counter_bill_terminal_records_terminal_id_fkey";
            columns: ["terminal_id"];
            isOneToOne: false;
            referencedRelation: "pos_terminals";
            referencedColumns: ["id"];
          },
        ];
      };
      counter_bills: {
        Row: {
          actor_id: string;
          created_at: string;
          order_id: string;
          payload: Json;
          pos_terminal_id: string | null;
          request_id: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          order_id: string;
          payload: Json;
          pos_terminal_id?: string | null;
          request_id: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          order_id?: string;
          payload?: Json;
          pos_terminal_id?: string | null;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "counter_bills_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "counter_bills_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "counter_bills_pos_terminal_id_fkey";
            columns: ["pos_terminal_id"];
            isOneToOne: false;
            referencedRelation: "pos_terminals";
            referencedColumns: ["id"];
          },
        ];
      };
      counter_tailoring_details: {
        Row: {
          bill_id: string;
          custom_design: string | null;
          delivery_date: string;
          design_code_snapshot: string | null;
          design_id: string | null;
          design_name_snapshot: string | null;
          job_id: string;
        };
        Insert: {
          bill_id: string;
          custom_design?: string | null;
          delivery_date: string;
          design_code_snapshot?: string | null;
          design_id?: string | null;
          design_name_snapshot?: string | null;
          job_id: string;
        };
        Update: {
          bill_id?: string;
          custom_design?: string | null;
          delivery_date?: string;
          design_code_snapshot?: string | null;
          design_id?: string | null;
          design_name_snapshot?: string | null;
          job_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "counter_tailoring_details_bill_id_fkey";
            columns: ["bill_id"];
            isOneToOne: false;
            referencedRelation: "counter_bills";
            referencedColumns: ["order_id"];
          },
          {
            foreignKeyName: "counter_tailoring_details_design_id_fkey";
            columns: ["design_id"];
            isOneToOne: false;
            referencedRelation: "designs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "counter_tailoring_details_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      counter_tailoring_prices: {
        Row: {
          cuts: Json;
          fabric_cp_total_paise: number | null;
          final_customer_price_paise: number;
          id: string | null;
          job_id: string;
          recorded_at: string;
          recorded_by: string;
        };
        Insert: {
          cuts: Json;
          fabric_cp_total_paise?: number | null;
          final_customer_price_paise: number;
          id?: string | null;
          job_id: string;
          recorded_at?: string;
          recorded_by: string;
        };
        Update: {
          cuts?: Json;
          fabric_cp_total_paise?: number | null;
          final_customer_price_paise?: number;
          id?: string | null;
          job_id?: string;
          recorded_at?: string;
          recorded_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "counter_tailoring_prices_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "counter_tailoring_prices_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      counter_tailoring_sale_prices: {
        Row: {
          fabric_amount_paise: number;
          fabric_lines: Json;
          job_id: string;
          recorded_at: string;
          recorded_by: string;
          stitching_paise: number;
          total_paise: number;
        };
        Insert: {
          fabric_amount_paise: number;
          fabric_lines: Json;
          job_id: string;
          recorded_at?: string;
          recorded_by: string;
          stitching_paise: number;
          total_paise: number;
        };
        Update: {
          fabric_amount_paise?: number;
          fabric_lines?: Json;
          job_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          stitching_paise?: number;
          total_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "counter_tailoring_sale_prices_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "counter_tailoring_details";
            referencedColumns: ["job_id"];
          },
          {
            foreignKeyName: "counter_tailoring_sale_prices_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_issue_fabric_costs: {
        Row: {
          amount_paise: number;
          cp_paise_per_m: number;
          fabric_cost_id: string;
          issue_line_id: string;
          recorded_at: string;
        };
        Insert: {
          amount_paise: number;
          cp_paise_per_m: number;
          fabric_cost_id: string;
          issue_line_id: string;
          recorded_at?: string;
        };
        Update: {
          amount_paise?: number;
          cp_paise_per_m?: number;
          fabric_cost_id?: string;
          issue_line_id?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_issue_fabric_costs_fabric_cost_id_fkey";
            columns: ["fabric_cost_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock_costs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_issue_fabric_costs_issue_line_id_fkey";
            columns: ["issue_line_id"];
            isOneToOne: true;
            referencedRelation: "material_issue_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_tailoring_completion_costs: {
        Row: {
          consumables_cp_paise: number;
          fabric_cp_paise: number;
          job_id: string;
          recorded_at: string;
          recorded_by: string;
          stitching_cp_paise: number;
          total_cp_paise: number | null;
        };
        Insert: {
          consumables_cp_paise: number;
          fabric_cp_paise: number;
          job_id: string;
          recorded_at?: string;
          recorded_by: string;
          stitching_cp_paise: number;
          total_cp_paise?: number | null;
        };
        Update: {
          consumables_cp_paise?: number;
          fabric_cp_paise?: number;
          job_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          stitching_cp_paise?: number;
          total_cp_paise?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_tailoring_completion_costs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_completion_costs_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_tailoring_finished_items: {
        Row: {
          barcode_id: string;
          created_at: string;
          created_by: string;
          id: string;
          job_id: string;
          name: string;
          request_id: string;
          size: string;
          sp_paise: number;
          status: string;
          workshop_location_id: string;
        };
        Insert: {
          barcode_id: string;
          created_at?: string;
          created_by: string;
          id?: string;
          job_id: string;
          name: string;
          request_id: string;
          size: string;
          sp_paise: number;
          status?: string;
          workshop_location_id: string;
        };
        Update: {
          barcode_id?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          job_id?: string;
          name?: string;
          request_id?: string;
          size?: string;
          sp_paise?: number;
          status?: string;
          workshop_location_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customer_tailoring_finished_items_barcode_id_fkey";
            columns: ["barcode_id"];
            isOneToOne: true;
            referencedRelation: "barcodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_finished_items_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_finished_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: true;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_finished_items_workshop_location_id_fkey";
            columns: ["workshop_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_tailoring_jobs: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          garment: string;
          id: string;
          legacy_job_id: string | null;
          notes: string | null;
          quote_id: string | null;
          request_id: string | null;
          request_payload: Json | null;
          salesperson_user_id: string | null;
          scan_code: string | null;
          size: string | null;
          status: string;
          tailor_assignment_id: string;
          tailoring_charge_version_id: string | null;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          garment: string;
          id?: string;
          legacy_job_id?: string | null;
          notes?: string | null;
          quote_id?: string | null;
          request_id?: string | null;
          request_payload?: Json | null;
          salesperson_user_id?: string | null;
          scan_code?: string | null;
          size?: string | null;
          status?: string;
          tailor_assignment_id: string;
          tailoring_charge_version_id?: string | null;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          garment?: string;
          id?: string;
          legacy_job_id?: string | null;
          notes?: string | null;
          quote_id?: string | null;
          request_id?: string | null;
          request_payload?: Json | null;
          salesperson_user_id?: string | null;
          scan_code?: string | null;
          size?: string | null;
          status?: string;
          tailor_assignment_id?: string;
          tailoring_charge_version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "customer_tailoring_jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_jobs_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_jobs_legacy_job_id_fkey";
            columns: ["legacy_job_id"];
            isOneToOne: true;
            referencedRelation: "tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_jobs_quote_id_fkey";
            columns: ["quote_id"];
            isOneToOne: true;
            referencedRelation: "customer_tailoring_quotes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_jobs_salesperson_user_id_fkey";
            columns: ["salesperson_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_jobs_tailor_assignment_id_fkey";
            columns: ["tailor_assignment_id"];
            isOneToOne: false;
            referencedRelation: "tailor_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_jobs_tailoring_charge_version_id_fkey";
            columns: ["tailoring_charge_version_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_charge_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_tailoring_prices: {
        Row: {
          charge_version_id: string;
          fabric_cp_total_paise: number;
          final_customer_price_paise: number | null;
          id: string;
          job_id: string;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
          tailoring_charge_paise: number;
        };
        Insert: {
          charge_version_id: string;
          fabric_cp_total_paise: number;
          final_customer_price_paise?: number | null;
          id?: string;
          job_id: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
          tailoring_charge_paise: number;
        };
        Update: {
          charge_version_id?: string;
          fabric_cp_total_paise?: number;
          final_customer_price_paise?: number | null;
          id?: string;
          job_id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
          tailoring_charge_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "customer_tailoring_prices_charge_version_id_fkey";
            columns: ["charge_version_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_charge_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_prices_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_prices_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      customer_tailoring_quotes: {
        Row: {
          charge_version_id: string;
          created_at: string;
          created_by: string;
          cuts: Json;
          fabric_cp_total_paise: number;
          final_customer_price_paise: number | null;
          id: string;
          source_location_id: string;
          tailoring_charge_paise: number;
        };
        Insert: {
          charge_version_id: string;
          created_at?: string;
          created_by: string;
          cuts: Json;
          fabric_cp_total_paise: number;
          final_customer_price_paise?: number | null;
          id?: string;
          source_location_id: string;
          tailoring_charge_paise: number;
        };
        Update: {
          charge_version_id?: string;
          created_at?: string;
          created_by?: string;
          cuts?: Json;
          fabric_cp_total_paise?: number;
          final_customer_price_paise?: number | null;
          id?: string;
          source_location_id?: string;
          tailoring_charge_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "customer_tailoring_quotes_charge_version_id_fkey";
            columns: ["charge_version_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_charge_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_quotes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customer_tailoring_quotes_source_location_id_fkey";
            columns: ["source_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          birth_date: string | null;
          created_at: string;
          id: string;
          name: string | null;
          notes: string | null;
          phone: string | null;
          whatsapp_phone: string | null;
        };
        Insert: {
          birth_date?: string | null;
          created_at?: string;
          id?: string;
          name?: string | null;
          notes?: string | null;
          phone?: string | null;
          whatsapp_phone?: string | null;
        };
        Update: {
          birth_date?: string | null;
          created_at?: string;
          id?: string;
          name?: string | null;
          notes?: string | null;
          phone?: string | null;
          whatsapp_phone?: string | null;
        };
        Relationships: [];
      };
      defective_return_lines: {
        Row: {
          condition_note: string | null;
          credit_paise: number;
          customer_tailoring_job_id: string | null;
          disposition: string;
          finished_product_id: string | null;
          id: string;
          original_order_item_id: string;
          quantity: number;
          replacement_finished_product_id: string | null;
          return_id: string;
          thaan_id: string | null;
          unit: string;
        };
        Insert: {
          condition_note?: string | null;
          credit_paise: number;
          customer_tailoring_job_id?: string | null;
          disposition: string;
          finished_product_id?: string | null;
          id?: string;
          original_order_item_id: string;
          quantity: number;
          replacement_finished_product_id?: string | null;
          return_id: string;
          thaan_id?: string | null;
          unit: string;
        };
        Update: {
          condition_note?: string | null;
          credit_paise?: number;
          customer_tailoring_job_id?: string | null;
          disposition?: string;
          finished_product_id?: string | null;
          id?: string;
          original_order_item_id?: string;
          quantity?: number;
          replacement_finished_product_id?: string | null;
          return_id?: string;
          thaan_id?: string | null;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "defective_return_lines_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_original_order_item_id_fkey";
            columns: ["original_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_replacement_finished_product_id_fkey";
            columns: ["replacement_finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: false;
            referencedRelation: "defective_returns";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_return_lines_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      defective_returns: {
        Row: {
          code: string;
          created_at: string;
          created_by: string;
          exchange_order_id: string | null;
          id: string;
          original_order_id: string;
          payment_method: string | null;
          reason: string;
          request_id: string;
          resolution: string;
          status: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by: string;
          exchange_order_id?: string | null;
          id?: string;
          original_order_id: string;
          payment_method?: string | null;
          reason: string;
          request_id: string;
          resolution: string;
          status: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string;
          exchange_order_id?: string | null;
          id?: string;
          original_order_id?: string;
          payment_method?: string | null;
          reason?: string;
          request_id?: string;
          resolution?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "defective_returns_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_returns_exchange_order_id_fkey";
            columns: ["exchange_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "defective_returns_original_order_id_fkey";
            columns: ["original_order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      design_charge_versions: {
        Row: {
          amount_paise: number;
          design_id: string;
          id: string;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
        };
        Insert: {
          amount_paise: number;
          design_id: string;
          id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
        };
        Update: {
          amount_paise?: number;
          design_id?: string;
          id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "design_charge_versions_design_id_fkey";
            columns: ["design_id"];
            isOneToOne: false;
            referencedRelation: "designs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "design_charge_versions_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      designs: {
        Row: {
          active: boolean;
          code: string;
          id: string;
          name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          id?: string;
          name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      domain_reconciliation: {
        Row: {
          created_at: string;
          details: Json;
          id: string;
          issue: string;
          legacy_id: string;
          legacy_table: string;
          resolution: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
        };
        Insert: {
          created_at?: string;
          details?: Json;
          id?: string;
          issue: string;
          legacy_id: string;
          legacy_table: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Update: {
          created_at?: string;
          details?: Json;
          id?: string;
          issue?: string;
          legacy_id?: string;
          legacy_table?: string;
          resolution?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "domain_reconciliation_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ecommerce_paid_receipts: {
        Row: {
          external_order: string;
          order_id: string;
          paid_at: string;
          paid_total_paise: number;
          payload: Json;
          payment_reference: string;
          recorded_at: string;
          recorded_by: string;
          request_id: string;
        };
        Insert: {
          external_order: string;
          order_id: string;
          paid_at: string;
          paid_total_paise: number;
          payload: Json;
          payment_reference: string;
          recorded_at?: string;
          recorded_by: string;
          request_id: string;
        };
        Update: {
          external_order?: string;
          order_id?: string;
          paid_at?: string;
          paid_total_paise?: number;
          payload?: Json;
          payment_reference?: string;
          recorded_at?: string;
          recorded_by?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ecommerce_paid_receipts_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ecommerce_paid_receipts_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      ecommerce_sale_sources: {
        Row: {
          order_item_id: string;
          source_location_id: string;
        };
        Insert: {
          order_item_id: string;
          source_location_id: string;
        };
        Update: {
          order_item_id?: string;
          source_location_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ecommerce_sale_sources_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: true;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ecommerce_sale_sources_source_location_id_fkey";
            columns: ["source_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      erp_audit_records: {
        Row: {
          action: string;
          actor_id: string | null;
          entity_id: string;
          entity_table: string;
          id: string;
          new_value: Json | null;
          occurred_at: string;
          previous_value: Json | null;
          reference: string | null;
        };
        Insert: {
          action: string;
          actor_id?: string | null;
          entity_id: string;
          entity_table: string;
          id?: string;
          new_value?: Json | null;
          occurred_at?: string;
          previous_value?: Json | null;
          reference?: string | null;
        };
        Update: {
          action?: string;
          actor_id?: string | null;
          entity_id?: string;
          entity_table?: string;
          id?: string;
          new_value?: Json | null;
          occurred_at?: string;
          previous_value?: Json | null;
          reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "erp_audit_records_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fabric_entry_requests: {
        Row: {
          created_at: string;
          created_by: string;
          fabric_stock_id: string;
          payload: Json;
          request_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          fabric_stock_id: string;
          payload: Json;
          request_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          fabric_stock_id?: string;
          payload?: Json;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fabric_entry_requests_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fabric_entry_requests_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: true;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
        ];
      };
      fabric_stock: {
        Row: {
          barcode_id: string;
          barcode_kind: string;
          batch_id: string;
          created_at: string;
          created_by: string | null;
          entry_state: string;
          fabric_id: string;
          id: string;
        };
        Insert: {
          barcode_id: string;
          barcode_kind?: string;
          batch_id: string;
          created_at?: string;
          created_by?: string | null;
          entry_state?: string;
          fabric_id: string;
          id?: string;
        };
        Update: {
          barcode_id?: string;
          barcode_kind?: string;
          batch_id?: string;
          created_at?: string;
          created_by?: string | null;
          entry_state?: string;
          fabric_id?: string;
          id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fabric_stock_barcode_id_barcode_kind_fkey";
            columns: ["barcode_id", "barcode_kind"];
            isOneToOne: false;
            referencedRelation: "barcodes";
            referencedColumns: ["id", "kind"];
          },
          {
            foreignKeyName: "fabric_stock_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "receiving_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fabric_stock_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fabric_stock_fabric_id_fkey";
            columns: ["fabric_id"];
            isOneToOne: false;
            referencedRelation: "fabrics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fabric_stock_fabric_id_fkey";
            columns: ["fabric_id"];
            isOneToOne: false;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["fabric_id"];
          },
        ];
      };
      fabric_stock_costs: {
        Row: {
          cp_paise_per_m: number;
          fabric_stock_id: string;
          id: string;
          reason: string | null;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
        };
        Insert: {
          cp_paise_per_m: number;
          fabric_stock_id: string;
          id?: string;
          reason?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
        };
        Update: {
          cp_paise_per_m?: number;
          fabric_stock_id?: string;
          id?: string;
          reason?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fabric_stock_costs_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fabric_stock_costs_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      fabric_stock_prices: {
        Row: {
          fabric_stock_id: string;
          id: string;
          reason: string | null;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
          sp_paise_per_m: number;
        };
        Insert: {
          fabric_stock_id: string;
          id?: string;
          reason?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
          sp_paise_per_m: number;
        };
        Update: {
          fabric_stock_id?: string;
          id?: string;
          reason?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
          sp_paise_per_m?: number;
        };
        Relationships: [
          {
            foreignKeyName: "fabric_stock_prices_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fabric_stock_prices_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
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
      factory_user_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          recorded_at: string;
          request_id: string;
          result_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          recorded_at?: string;
          request_id: string;
          result_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          recorded_at?: string;
          request_id?: string;
          result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "factory_user_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "factory_user_requests_result_id_fkey";
            columns: ["result_id"];
            isOneToOne: false;
            referencedRelation: "tailor_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_cost_allocations: {
        Row: {
          amount_paise: number;
          cost_version_id: string;
          finished_product_id: string;
          id: string;
          production_job_id: string;
          recorded_at: string;
        };
        Insert: {
          amount_paise: number;
          cost_version_id: string;
          finished_product_id: string;
          id?: string;
          production_job_id: string;
          recorded_at?: string;
        };
        Update: {
          amount_paise?: number;
          cost_version_id?: string;
          finished_product_id?: string;
          id?: string;
          production_job_id?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_cost_allocat_cost_version_id_production_j_fkey";
            columns: ["cost_version_id", "production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_cost_versions";
            referencedColumns: ["id", "production_job_id"];
          },
          {
            foreignKeyName: "finished_product_cost_allocat_finished_product_id_producti_fkey";
            columns: ["finished_product_id", "production_job_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id", "production_job_id"];
          },
        ];
      };
      finished_product_exchange_batches: {
        Row: {
          created_at: string;
          created_by: string;
          exchange_bill_id: string;
          net_difference_paise: number;
          original_bill_id: string;
          payment_method: string;
          replacement_value_paise: number;
          return_credit_paise: number;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          exchange_bill_id: string;
          net_difference_paise: number;
          original_bill_id: string;
          payment_method: string;
          replacement_value_paise: number;
          return_credit_paise: number;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          exchange_bill_id?: string;
          net_difference_paise?: number;
          original_bill_id?: string;
          payment_method?: string;
          replacement_value_paise?: number;
          return_credit_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_exchange_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchange_batches_exchange_bill_id_fkey";
            columns: ["exchange_bill_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchange_batches_original_bill_id_fkey";
            columns: ["original_bill_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_exchange_lines: {
        Row: {
          direction: string;
          exchange_bill_id: string;
          exchange_order_item_id: string | null;
          finished_product_id: string;
          id: string;
          original_order_item_id: string | null;
          value_paise: number;
        };
        Insert: {
          direction: string;
          exchange_bill_id: string;
          exchange_order_item_id?: string | null;
          finished_product_id: string;
          id?: string;
          original_order_item_id?: string | null;
          value_paise: number;
        };
        Update: {
          direction?: string;
          exchange_bill_id?: string;
          exchange_order_item_id?: string | null;
          finished_product_id?: string;
          id?: string;
          original_order_item_id?: string | null;
          value_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_exchange_lines_exchange_bill_id_fkey";
            columns: ["exchange_bill_id"];
            isOneToOne: false;
            referencedRelation: "finished_product_exchange_batches";
            referencedColumns: ["exchange_bill_id"];
          },
          {
            foreignKeyName: "finished_product_exchange_lines_exchange_order_item_id_fkey";
            columns: ["exchange_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchange_lines_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchange_lines_original_order_item_id_fkey";
            columns: ["original_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_exchange_settlements: {
        Row: {
          actor_id: string;
          amount_paise: number;
          direction: string;
          exchange_bill_id: string;
          payment_method: string;
          recorded_at: string;
        };
        Insert: {
          actor_id: string;
          amount_paise: number;
          direction: string;
          exchange_bill_id: string;
          payment_method: string;
          recorded_at?: string;
        };
        Update: {
          actor_id?: string;
          amount_paise?: number;
          direction?: string;
          exchange_bill_id?: string;
          payment_method?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_exchange_settlements_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchange_settlements_exchange_bill_id_fkey";
            columns: ["exchange_bill_id"];
            isOneToOne: true;
            referencedRelation: "finished_product_exchange_batches";
            referencedColumns: ["exchange_bill_id"];
          },
        ];
      };
      finished_product_exchanges: {
        Row: {
          created_at: string;
          created_by: string;
          exchange_bill_id: string;
          original_bill_id: string;
          replacement_finished_product_id: string;
          replacement_order_item_id: string;
          returned_finished_product_id: string;
          returned_order_item_id: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          exchange_bill_id: string;
          original_bill_id: string;
          replacement_finished_product_id: string;
          replacement_order_item_id: string;
          returned_finished_product_id: string;
          returned_order_item_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          exchange_bill_id?: string;
          original_bill_id?: string;
          replacement_finished_product_id?: string;
          replacement_order_item_id?: string;
          returned_finished_product_id?: string;
          returned_order_item_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_exchanges_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchanges_exchange_bill_id_fkey";
            columns: ["exchange_bill_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchanges_original_bill_id_fkey";
            columns: ["original_bill_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchanges_replacement_finished_product_id_fkey";
            columns: ["replacement_finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchanges_replacement_order_item_id_fkey";
            columns: ["replacement_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchanges_returned_finished_product_id_fkey";
            columns: ["returned_finished_product_id"];
            isOneToOne: true;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_exchanges_returned_order_item_id_fkey";
            columns: ["returned_order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_materials: {
        Row: {
          finished_product_id: string;
          id: string;
          material_issue_line_id: string;
          production_job_id: string;
          quantity: number;
          unit: string;
        };
        Insert: {
          finished_product_id: string;
          id?: string;
          material_issue_line_id: string;
          production_job_id: string;
          quantity: number;
          unit: string;
        };
        Update: {
          finished_product_id?: string;
          id?: string;
          material_issue_line_id?: string;
          production_job_id?: string;
          quantity?: number;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_materials_finished_product_id_production__fkey";
            columns: ["finished_product_id", "production_job_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id", "production_job_id"];
          },
          {
            foreignKeyName: "finished_product_materials_material_issue_line_id_fkey";
            columns: ["material_issue_line_id"];
            isOneToOne: false;
            referencedRelation: "material_issue_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_price_reviews: {
        Row: {
          cost_version_id: string;
          price_id: string;
          reason: string;
          request_id: string;
        };
        Insert: {
          cost_version_id: string;
          price_id: string;
          reason: string;
          request_id: string;
        };
        Update: {
          cost_version_id?: string;
          price_id?: string;
          reason?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_price_reviews_cost_version_id_fkey";
            columns: ["cost_version_id"];
            isOneToOne: false;
            referencedRelation: "production_cost_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_price_reviews_price_id_fkey";
            columns: ["price_id"];
            isOneToOne: true;
            referencedRelation: "finished_product_prices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_price_reviews_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "production_cost_requests";
            referencedColumns: ["request_id"];
          },
        ];
      };
      finished_product_prices: {
        Row: {
          finished_product_id: string;
          id: string;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
          sp_paise: number;
        };
        Insert: {
          finished_product_id: string;
          id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
          sp_paise: number;
        };
        Update: {
          finished_product_id?: string;
          id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
          sp_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_prices_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_prices_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_receipt_pieces: {
        Row: {
          finished_product_id: string;
          request_id: string;
        };
        Insert: {
          finished_product_id: string;
          request_id: string;
        };
        Update: {
          finished_product_id?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_receipt_pieces_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: true;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_receipt_pieces_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: false;
            referencedRelation: "finished_product_receipts";
            referencedColumns: ["request_id"];
          },
        ];
      };
      finished_product_receipts: {
        Row: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          reason: string;
          recorded_at: string;
          request_id: string;
          workshop_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          reason: string;
          recorded_at?: string;
          request_id: string;
          workshop_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          production_job_id?: string;
          reason?: string;
          recorded_at?: string;
          request_id?: string;
          workshop_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_receipts_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_receipts_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: true;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_receipts_workshop_id_fkey";
            columns: ["workshop_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_sale_snapshots: {
        Row: {
          cost_evidence: Json;
          cost_version_id: string | null;
          item_snapshot: Json;
          order_item_id: string;
          price_version_id: string;
          recorded_at: string;
          reviewed_cost_version_id: string | null;
        };
        Insert: {
          cost_evidence: Json;
          cost_version_id?: string | null;
          item_snapshot: Json;
          order_item_id: string;
          price_version_id: string;
          recorded_at?: string;
          reviewed_cost_version_id?: string | null;
        };
        Update: {
          cost_evidence?: Json;
          cost_version_id?: string | null;
          item_snapshot?: Json;
          order_item_id?: string;
          price_version_id?: string;
          recorded_at?: string;
          reviewed_cost_version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_sale_snapshots_cost_version_id_fkey";
            columns: ["cost_version_id"];
            isOneToOne: false;
            referencedRelation: "production_cost_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_sale_snapshots_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: true;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_sale_snapshots_price_version_id_fkey";
            columns: ["price_version_id"];
            isOneToOne: false;
            referencedRelation: "finished_product_prices";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_sale_snapshots_reviewed_cost_version_id_fkey";
            columns: ["reviewed_cost_version_id"];
            isOneToOne: false;
            referencedRelation: "production_cost_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_product_transfer_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          recorded_at: string;
          request_id: string;
          transfer_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          recorded_at?: string;
          request_id: string;
          transfer_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          recorded_at?: string;
          request_id?: string;
          transfer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "finished_product_transfer_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_product_transfer_requests_transfer_id_fkey";
            columns: ["transfer_id"];
            isOneToOne: true;
            referencedRelation: "stock_transfers";
            referencedColumns: ["id"];
          },
        ];
      };
      finished_products: {
        Row: {
          barcode_id: string;
          barcode_kind: string;
          created_at: string;
          current_location_id: string;
          design_id: string | null;
          id: string;
          piece_number: number;
          product_id: string;
          production_job_id: string | null;
          status: string;
          vendor_receipt_id: string | null;
        };
        Insert: {
          barcode_id: string;
          barcode_kind?: string;
          created_at?: string;
          current_location_id: string;
          design_id?: string | null;
          id?: string;
          piece_number: number;
          product_id: string;
          production_job_id?: string | null;
          status?: string;
          vendor_receipt_id?: string | null;
        };
        Update: {
          barcode_id?: string;
          barcode_kind?: string;
          created_at?: string;
          current_location_id?: string;
          design_id?: string | null;
          id?: string;
          piece_number?: number;
          product_id?: string;
          production_job_id?: string | null;
          status?: string;
          vendor_receipt_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "finished_products_barcode_id_barcode_kind_fkey";
            columns: ["barcode_id", "barcode_kind"];
            isOneToOne: false;
            referencedRelation: "barcodes";
            referencedColumns: ["id", "kind"];
          },
          {
            foreignKeyName: "finished_products_current_location_id_fkey";
            columns: ["current_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "finished_products_vendor_receipt_id_fkey";
            columns: ["vendor_receipt_id"];
            isOneToOne: false;
            referencedRelation: "vendor_finished_product_receipts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "piece_design_fkey";
            columns: ["design_id"];
            isOneToOne: false;
            referencedRelation: "designs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "piece_product_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "piece_production_job_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_configuration_requests: {
        Row: {
          actor_id: string;
          created_at: string;
          payload: Json;
          request_id: string;
          result_id: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          payload: Json;
          request_id: string;
          result_id: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          payload?: Json;
          request_id?: string;
          result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gst_configuration_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_configuration_requests_result_id_fkey";
            columns: ["result_id"];
            isOneToOne: false;
            referencedRelation: "gst_configuration_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_configuration_versions: {
        Row: {
          address: string;
          contact: string;
          created_at: string;
          created_by: string;
          effective_from: string;
          enabled: boolean;
          gstin: string;
          id: string;
          invoice_display: string;
          legal_name: string;
          price_mode: string;
          purchase_mode: string;
          state_code: string;
          tailoring_display: string;
          trading_name: string;
        };
        Insert: {
          address: string;
          contact: string;
          created_at?: string;
          created_by: string;
          effective_from: string;
          enabled?: boolean;
          gstin: string;
          id?: string;
          invoice_display: string;
          legal_name: string;
          price_mode: string;
          purchase_mode: string;
          state_code: string;
          tailoring_display: string;
          trading_name: string;
        };
        Update: {
          address?: string;
          contact?: string;
          created_at?: string;
          created_by?: string;
          effective_from?: string;
          enabled?: boolean;
          gstin?: string;
          id?: string;
          invoice_display?: string;
          legal_name?: string;
          price_mode?: string;
          purchase_mode?: string;
          state_code?: string;
          tailoring_display?: string;
          trading_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gst_configuration_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_garment_slab_versions: {
        Row: {
          effective_from: string;
          higher_rate_bps: number;
          id: string;
          lower_rate_bps: number;
          recorded_at: string;
          recorded_by: string;
          threshold_paise: number;
        };
        Insert: {
          effective_from: string;
          higher_rate_bps: number;
          id?: string;
          lower_rate_bps: number;
          recorded_at?: string;
          recorded_by: string;
          threshold_paise: number;
        };
        Update: {
          effective_from?: string;
          higher_rate_bps?: number;
          id?: string;
          lower_rate_bps?: number;
          recorded_at?: string;
          recorded_by?: string;
          threshold_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "gst_garment_slab_versions_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_invoice_lines: {
        Row: {
          cgst_paise: number;
          classification_code: string;
          component: string;
          description: string;
          display_group: string | null;
          entered_amount_paise: number;
          entered_rate_paise: number | null;
          final_paise: number;
          gst_paise: number;
          id: string;
          igst_paise: number;
          invoice_id: string;
          quantity: number;
          rate_bps: number;
          sgst_paise: number;
          source_cut_ordinal: number;
          source_item_id: string;
          taxable_paise: number;
          unit: string;
        };
        Insert: {
          cgst_paise: number;
          classification_code: string;
          component: string;
          description: string;
          display_group?: string | null;
          entered_amount_paise: number;
          entered_rate_paise?: number | null;
          final_paise: number;
          gst_paise: number;
          id?: string;
          igst_paise: number;
          invoice_id: string;
          quantity: number;
          rate_bps: number;
          sgst_paise: number;
          source_cut_ordinal?: number;
          source_item_id: string;
          taxable_paise: number;
          unit: string;
        };
        Update: {
          cgst_paise?: number;
          classification_code?: string;
          component?: string;
          description?: string;
          display_group?: string | null;
          entered_amount_paise?: number;
          entered_rate_paise?: number | null;
          final_paise?: number;
          gst_paise?: number;
          id?: string;
          igst_paise?: number;
          invoice_id?: string;
          quantity?: number;
          rate_bps?: number;
          sgst_paise?: number;
          source_cut_ordinal?: number;
          source_item_id?: string;
          taxable_paise?: number;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gst_invoice_lines_invoice_id_fkey";
            columns: ["invoice_id"];
            isOneToOne: false;
            referencedRelation: "gst_invoice_snapshots";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_invoice_lines_source_item_id_fkey";
            columns: ["source_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_invoice_snapshots: {
        Row: {
          business_snapshot: Json;
          cgst_paise: number;
          configuration_id: string;
          customer_snapshot: Json;
          discount_paise: number;
          final_paise: number;
          finalized: boolean;
          gst_paise: number;
          id: string;
          igst_paise: number;
          invoice_display: string;
          invoice_number: string;
          invoice_type: string;
          order_id: string;
          other_charge_paise: number;
          payment_method: string | null;
          price_mode: string;
          recorded_at: string;
          recorded_by: string;
          sgst_paise: number;
          supply_type: string;
          tailoring_display: string;
          taxable_paise: number;
        };
        Insert: {
          business_snapshot: Json;
          cgst_paise: number;
          configuration_id: string;
          customer_snapshot: Json;
          discount_paise?: number;
          final_paise: number;
          finalized?: boolean;
          gst_paise: number;
          id?: string;
          igst_paise: number;
          invoice_display: string;
          invoice_number: string;
          invoice_type?: string;
          order_id: string;
          other_charge_paise?: number;
          payment_method?: string | null;
          price_mode: string;
          recorded_at?: string;
          recorded_by: string;
          sgst_paise: number;
          supply_type: string;
          tailoring_display: string;
          taxable_paise: number;
        };
        Update: {
          business_snapshot?: Json;
          cgst_paise?: number;
          configuration_id?: string;
          customer_snapshot?: Json;
          discount_paise?: number;
          final_paise?: number;
          finalized?: boolean;
          gst_paise?: number;
          id?: string;
          igst_paise?: number;
          invoice_display?: string;
          invoice_number?: string;
          invoice_type?: string;
          order_id?: string;
          other_charge_paise?: number;
          payment_method?: string | null;
          price_mode?: string;
          recorded_at?: string;
          recorded_by?: string;
          sgst_paise?: number;
          supply_type?: string;
          tailoring_display?: string;
          taxable_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "gst_invoice_snapshots_configuration_id_fkey";
            columns: ["configuration_id"];
            isOneToOne: false;
            referencedRelation: "gst_configuration_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_invoice_snapshots_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_invoice_snapshots_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_purchase_documents: {
        Row: {
          actual_gst_paise: number | null;
          actual_supplier_paise: number | null;
          actual_taxable_paise: number | null;
          batch_id: string | null;
          calculated_gst_paise: number;
          calculated_supplier_paise: number;
          calculated_taxable_paise: number;
          configuration_id: string;
          difference_paise: number | null;
          eligible_itc_paise: number;
          finalized: boolean;
          id: string;
          ineligible_itc_paise: number;
          inventory_cost_adjustment_paise: number;
          itc_status: string;
          material_batch_id: string | null;
          purchase_mode: string;
          recorded_at: string;
          recorded_by: string;
          reversed_itc_paise: number;
          supplier_gstin: string | null;
          supplier_invoice_date: string | null;
          supplier_invoice_number: string | null;
          supplier_name: string;
          supply_type: string;
          transport_paise: number;
          vendor_receipt_id: string | null;
        };
        Insert: {
          actual_gst_paise?: number | null;
          actual_supplier_paise?: number | null;
          actual_taxable_paise?: number | null;
          batch_id?: string | null;
          calculated_gst_paise: number;
          calculated_supplier_paise: number;
          calculated_taxable_paise: number;
          configuration_id: string;
          difference_paise?: number | null;
          eligible_itc_paise?: number;
          finalized?: boolean;
          id?: string;
          ineligible_itc_paise?: number;
          inventory_cost_adjustment_paise?: number;
          itc_status: string;
          material_batch_id?: string | null;
          purchase_mode: string;
          recorded_at?: string;
          recorded_by: string;
          reversed_itc_paise?: number;
          supplier_gstin?: string | null;
          supplier_invoice_date?: string | null;
          supplier_invoice_number?: string | null;
          supplier_name: string;
          supply_type: string;
          transport_paise?: number;
          vendor_receipt_id?: string | null;
        };
        Update: {
          actual_gst_paise?: number | null;
          actual_supplier_paise?: number | null;
          actual_taxable_paise?: number | null;
          batch_id?: string | null;
          calculated_gst_paise?: number;
          calculated_supplier_paise?: number;
          calculated_taxable_paise?: number;
          configuration_id?: string;
          difference_paise?: number | null;
          eligible_itc_paise?: number;
          finalized?: boolean;
          id?: string;
          ineligible_itc_paise?: number;
          inventory_cost_adjustment_paise?: number;
          itc_status?: string;
          material_batch_id?: string | null;
          purchase_mode?: string;
          recorded_at?: string;
          recorded_by?: string;
          reversed_itc_paise?: number;
          supplier_gstin?: string | null;
          supplier_invoice_date?: string | null;
          supplier_invoice_number?: string | null;
          supplier_name?: string;
          supply_type?: string;
          transport_paise?: number;
          vendor_receipt_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "gst_purchase_documents_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: true;
            referencedRelation: "receiving_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_purchase_documents_configuration_id_fkey";
            columns: ["configuration_id"];
            isOneToOne: false;
            referencedRelation: "gst_configuration_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_purchase_documents_material_batch_id_fkey";
            columns: ["material_batch_id"];
            isOneToOne: false;
            referencedRelation: "material_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_purchase_documents_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_purchase_documents_vendor_receipt_id_fkey";
            columns: ["vendor_receipt_id"];
            isOneToOne: false;
            referencedRelation: "vendor_finished_product_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_purchase_lines: {
        Row: {
          base_cp_paise_per_m: number;
          cgst_paise: number;
          classification_code: string;
          description: string;
          gst_paise: number;
          id: string;
          igst_paise: number;
          length_mm: number;
          purchase_id: string;
          rate_bps: number;
          sgst_paise: number;
          supplier_paise: number;
          taxable_paise: number;
          variant_id: string;
        };
        Insert: {
          base_cp_paise_per_m: number;
          cgst_paise: number;
          classification_code: string;
          description: string;
          gst_paise: number;
          id?: string;
          igst_paise: number;
          length_mm: number;
          purchase_id: string;
          rate_bps: number;
          sgst_paise: number;
          supplier_paise: number;
          taxable_paise: number;
          variant_id: string;
        };
        Update: {
          base_cp_paise_per_m?: number;
          cgst_paise?: number;
          classification_code?: string;
          description?: string;
          gst_paise?: number;
          id?: string;
          igst_paise?: number;
          length_mm?: number;
          purchase_id?: string;
          rate_bps?: number;
          sgst_paise?: number;
          supplier_paise?: number;
          taxable_paise?: number;
          variant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gst_purchase_lines_purchase_id_fkey";
            columns: ["purchase_id"];
            isOneToOne: false;
            referencedRelation: "gst_purchase_documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "gst_purchase_lines_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "stock_registration_variants";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_tax_adjustments: {
        Row: {
          amount_paise: number;
          effective_date: string;
          id: string;
          kind: string;
          reason: string;
          recorded_at: string;
          recorded_by: string;
          reference: string;
        };
        Insert: {
          amount_paise: number;
          effective_date: string;
          id?: string;
          kind: string;
          reason: string;
          recorded_at?: string;
          recorded_by: string;
          reference: string;
        };
        Update: {
          amount_paise?: number;
          effective_date?: string;
          id?: string;
          kind?: string;
          reason?: string;
          recorded_at?: string;
          recorded_by?: string;
          reference?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gst_tax_adjustments_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      gst_tax_rules: {
        Row: {
          category: string;
          classification_code: string;
          configuration_id: string;
          created_at: string;
          id: string;
          item_ref: string | null;
          label: string | null;
          rate_bps: number;
        };
        Insert: {
          category: string;
          classification_code: string;
          configuration_id: string;
          created_at?: string;
          id?: string;
          item_ref?: string | null;
          label?: string | null;
          rate_bps: number;
        };
        Update: {
          category?: string;
          classification_code?: string;
          configuration_id?: string;
          created_at?: string;
          id?: string;
          item_ref?: string | null;
          label?: string | null;
          rate_bps?: number;
        };
        Relationships: [
          {
            foreignKeyName: "gst_tax_rules_configuration_id_fkey";
            columns: ["configuration_id"];
            isOneToOne: false;
            referencedRelation: "gst_configuration_versions";
            referencedColumns: ["id"];
          },
        ];
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
      inventory_items: {
        Row: {
          finished_product_id: string | null;
          id: string;
          legacy_quantity_snapshot: number;
          material_id: string | null;
          reason: string;
          reconciled_at: string;
          reconciled_by: string;
          thaan_id: string | null;
          unit: string;
        };
        Insert: {
          finished_product_id?: string | null;
          id?: string;
          legacy_quantity_snapshot: number;
          material_id?: string | null;
          reason: string;
          reconciled_at?: string;
          reconciled_by: string;
          thaan_id?: string | null;
          unit: string;
        };
        Update: {
          finished_product_id?: string | null;
          id?: string;
          legacy_quantity_snapshot?: number;
          material_id?: string | null;
          reason?: string;
          reconciled_at?: string;
          reconciled_by?: string;
          thaan_id?: string | null;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: true;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: true;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_reconciled_by_fkey";
            columns: ["reconciled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          actor_id: string | null;
          consumable_receipt_id: string | null;
          customer_tailoring_job_id: string | null;
          destination_location_id: string | null;
          fabric_stock_id: string | null;
          finished_product_id: string | null;
          id: string;
          inventory_item_id: string | null;
          kind: string;
          legacy_stock_movement_id: string | null;
          material_id: string | null;
          material_issue_line_id: string | null;
          occurred_at: string;
          order_item_id: string | null;
          production_job_id: string | null;
          quantity: number;
          reason: string | null;
          reference: string | null;
          source_location_id: string | null;
          stock_transfer_line_id: string | null;
          thaan_id: string | null;
          unit: string;
        };
        Insert: {
          actor_id?: string | null;
          consumable_receipt_id?: string | null;
          customer_tailoring_job_id?: string | null;
          destination_location_id?: string | null;
          fabric_stock_id?: string | null;
          finished_product_id?: string | null;
          id?: string;
          inventory_item_id?: string | null;
          kind: string;
          legacy_stock_movement_id?: string | null;
          material_id?: string | null;
          material_issue_line_id?: string | null;
          occurred_at?: string;
          order_item_id?: string | null;
          production_job_id?: string | null;
          quantity: number;
          reason?: string | null;
          reference?: string | null;
          source_location_id?: string | null;
          stock_transfer_line_id?: string | null;
          thaan_id?: string | null;
          unit: string;
        };
        Update: {
          actor_id?: string | null;
          consumable_receipt_id?: string | null;
          customer_tailoring_job_id?: string | null;
          destination_location_id?: string | null;
          fabric_stock_id?: string | null;
          finished_product_id?: string | null;
          id?: string;
          inventory_item_id?: string | null;
          kind?: string;
          legacy_stock_movement_id?: string | null;
          material_id?: string | null;
          material_issue_line_id?: string | null;
          occurred_at?: string;
          order_item_id?: string | null;
          production_job_id?: string | null;
          quantity?: number;
          reason?: string | null;
          reference?: string | null;
          source_location_id?: string | null;
          stock_transfer_line_id?: string | null;
          thaan_id?: string | null;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_consumable_receipt_id_fkey";
            columns: ["consumable_receipt_id"];
            isOneToOne: true;
            referencedRelation: "consumable_receipts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_destination_location_id_fkey";
            columns: ["destination_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "inventory_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_inventory_item_id_fkey";
            columns: ["inventory_item_id"];
            isOneToOne: false;
            referencedRelation: "v_inventory_location_balances";
            referencedColumns: ["inventory_item_id"];
          },
          {
            foreignKeyName: "inventory_movements_legacy_stock_movement_id_fkey";
            columns: ["legacy_stock_movement_id"];
            isOneToOne: true;
            referencedRelation: "stock_movements";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_legacy_stock_movement_id_fkey";
            columns: ["legacy_stock_movement_id"];
            isOneToOne: true;
            referencedRelation: "v_movement_log";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_material_issue_line_id_fkey";
            columns: ["material_issue_line_id"];
            isOneToOne: false;
            referencedRelation: "material_issue_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: false;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_source_location_id_fkey";
            columns: ["source_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_stock_transfer_line_id_fkey";
            columns: ["stock_transfer_line_id"];
            isOneToOne: false;
            referencedRelation: "stock_transfer_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_thaan_id_fabric_stock_id_fkey";
            columns: ["thaan_id", "fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id", "fabric_stock_id"];
          },
        ];
      };
      job_material_consumption_lines: {
        Row: {
          amount_paise: number;
          consumption_id: string;
          cp_per_quantity_paise: number;
          id: string;
          material_unit_id: string;
          quantity: number;
          unit: string;
        };
        Insert: {
          amount_paise: number;
          consumption_id: string;
          cp_per_quantity_paise: number;
          id?: string;
          material_unit_id: string;
          quantity: number;
          unit: string;
        };
        Update: {
          amount_paise?: number;
          consumption_id?: string;
          cp_per_quantity_paise?: number;
          id?: string;
          material_unit_id?: string;
          quantity?: number;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_material_consumption_lines_consumption_id_fkey";
            columns: ["consumption_id"];
            isOneToOne: false;
            referencedRelation: "job_material_consumptions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_consumption_lines_material_unit_id_fkey";
            columns: ["material_unit_id"];
            isOneToOne: false;
            referencedRelation: "material_units";
            referencedColumns: ["id"];
          },
        ];
      };
      job_material_consumptions: {
        Row: {
          customer_tailoring_job_id: string | null;
          id: string;
          production_job_id: string | null;
          request_id: string;
          request_payload: Json;
          reversal_reason: string | null;
          reversed_at: string | null;
          reversed_by: string | null;
          submitted_at: string;
          submitted_by: string;
          tailor_assignment_id: string;
          tailor_staff_assignment_id: string;
        };
        Insert: {
          customer_tailoring_job_id?: string | null;
          id?: string;
          production_job_id?: string | null;
          request_id: string;
          request_payload: Json;
          reversal_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          submitted_at?: string;
          submitted_by: string;
          tailor_assignment_id: string;
          tailor_staff_assignment_id: string;
        };
        Update: {
          customer_tailoring_job_id?: string | null;
          id?: string;
          production_job_id?: string | null;
          request_id?: string;
          request_payload?: Json;
          reversal_reason?: string | null;
          reversed_at?: string | null;
          reversed_by?: string | null;
          submitted_at?: string;
          submitted_by?: string;
          tailor_assignment_id?: string;
          tailor_staff_assignment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_material_consumptions_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_consumptions_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_consumptions_reversed_by_fkey";
            columns: ["reversed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_consumptions_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_consumptions_tailor_assignment_id_fkey";
            columns: ["tailor_assignment_id"];
            isOneToOne: false;
            referencedRelation: "tailor_assignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_consumptions_tailor_staff_assignment_id_fkey";
            columns: ["tailor_staff_assignment_id"];
            isOneToOne: false;
            referencedRelation: "tailor_staff_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      job_material_requirements: {
        Row: {
          customer_tailoring_job_id: string | null;
          fabric_stock_id: string | null;
          id: string;
          material_id: string | null;
          material_issue_line_id: string | null;
          production_job_id: string | null;
          quantity: number;
          unit: string;
        };
        Insert: {
          customer_tailoring_job_id?: string | null;
          fabric_stock_id?: string | null;
          id?: string;
          material_id?: string | null;
          material_issue_line_id?: string | null;
          production_job_id?: string | null;
          quantity: number;
          unit: string;
        };
        Update: {
          customer_tailoring_job_id?: string | null;
          fabric_stock_id?: string | null;
          id?: string;
          material_id?: string | null;
          material_issue_line_id?: string | null;
          production_job_id?: string | null;
          quantity?: number;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_material_requirements_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_requirements_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_requirements_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_requirements_material_issue_line_id_fkey";
            columns: ["material_issue_line_id"];
            isOneToOne: true;
            referencedRelation: "material_issue_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_material_requirements_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      job_workflow_events: {
        Row: {
          actor_id: string | null;
          customer_tailoring_job_id: string | null;
          details: Json;
          id: string;
          job_kind: string;
          occurred_at: string;
          production_job_id: string | null;
          source_id: string;
          source_table: string;
          stage: string;
        };
        Insert: {
          actor_id?: string | null;
          customer_tailoring_job_id?: string | null;
          details?: Json;
          id?: string;
          job_kind: string;
          occurred_at?: string;
          production_job_id?: string | null;
          source_id: string;
          source_table: string;
          stage: string;
        };
        Update: {
          actor_id?: string | null;
          customer_tailoring_job_id?: string | null;
          details?: Json;
          id?: string;
          job_kind?: string;
          occurred_at?: string;
          production_job_id?: string | null;
          source_id?: string;
          source_table?: string;
          stage?: string;
        };
        Relationships: [
          {
            foreignKeyName: "job_workflow_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_workflow_events_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "job_workflow_events_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_finished_product_links: {
        Row: {
          finished_product_id: string;
          listing_id: string;
        };
        Insert: {
          finished_product_id: string;
          listing_id: string;
        };
        Update: {
          finished_product_id?: string;
          listing_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "listing_finished_product_links_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_finished_product_links_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
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
        ];
      };
      listings: {
        Row: {
          archived_at: string | null;
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
          archived_at?: string | null;
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
          archived_at?: string | null;
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
      locations: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          kind: string;
          name: string;
          parent_id: string | null;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          kind: string;
          name: string;
          parent_id?: string | null;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          kind?: string;
          name?: string;
          parent_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "locations_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      material_batches: {
        Row: {
          arrival_date: string;
          code: string;
          id: string;
          received_at: string;
          received_by: string;
          request_id: string;
          request_payload: Json;
          shared_expense_paise: number;
          supplier_name: string;
          supplier_reference: string | null;
        };
        Insert: {
          arrival_date?: string;
          code: string;
          id?: string;
          received_at?: string;
          received_by: string;
          request_id: string;
          request_payload: Json;
          shared_expense_paise?: number;
          supplier_name: string;
          supplier_reference?: string | null;
        };
        Update: {
          arrival_date?: string;
          code?: string;
          id?: string;
          received_at?: string;
          received_by?: string;
          request_id?: string;
          request_payload?: Json;
          shared_expense_paise?: number;
          supplier_name?: string;
          supplier_reference?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "material_batches_received_by_fkey";
            columns: ["received_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      material_category_definitions: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          created_by: string | null;
          id: string;
          measurement_unit: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          measurement_unit: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          measurement_unit?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "material_category_definitions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      material_issue_lines: {
        Row: {
          fabric_stock_id: string | null;
          id: string;
          material_id: string | null;
          material_issue_id: string;
          quantity: number;
          thaan_id: string | null;
          unit: string;
        };
        Insert: {
          fabric_stock_id?: string | null;
          id?: string;
          material_id?: string | null;
          material_issue_id: string;
          quantity: number;
          thaan_id?: string | null;
          unit: string;
        };
        Update: {
          fabric_stock_id?: string | null;
          id?: string;
          material_id?: string | null;
          material_issue_id?: string;
          quantity?: number;
          thaan_id?: string | null;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "material_issue_lines_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issue_lines_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issue_lines_material_issue_id_fkey";
            columns: ["material_issue_id"];
            isOneToOne: false;
            referencedRelation: "material_issues";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issue_lines_thaan_id_fabric_stock_id_fkey";
            columns: ["thaan_id", "fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id", "fabric_stock_id"];
          },
        ];
      };
      material_issues: {
        Row: {
          code: string;
          customer_tailoring_job_id: string | null;
          id: string;
          issue_type: string;
          issued_at: string;
          issued_by: string | null;
          production_job_id: string | null;
          reason: string | null;
          request_id: string | null;
          request_payload: Json | null;
          source_location_id: string;
          tailor_assignment_id: string;
        };
        Insert: {
          code: string;
          customer_tailoring_job_id?: string | null;
          id?: string;
          issue_type?: string;
          issued_at?: string;
          issued_by?: string | null;
          production_job_id?: string | null;
          reason?: string | null;
          request_id?: string | null;
          request_payload?: Json | null;
          source_location_id: string;
          tailor_assignment_id: string;
        };
        Update: {
          code?: string;
          customer_tailoring_job_id?: string | null;
          id?: string;
          issue_type?: string;
          issued_at?: string;
          issued_by?: string | null;
          production_job_id?: string | null;
          reason?: string | null;
          request_id?: string | null;
          request_payload?: Json | null;
          source_location_id?: string;
          tailor_assignment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "material_issues_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issues_issued_by_fkey";
            columns: ["issued_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issues_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issues_source_location_id_fkey";
            columns: ["source_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_issues_tailor_assignment_id_fkey";
            columns: ["tailor_assignment_id"];
            isOneToOne: false;
            referencedRelation: "tailor_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      material_unit_transfers: {
        Row: {
          from_factory_id: string | null;
          from_tailor_id: string | null;
          id: string;
          material_unit_id: string;
          request_id: string;
          request_payload: Json;
          to_factory_id: string;
          to_tailor_id: string;
          transferred_at: string;
          transferred_by: string;
        };
        Insert: {
          from_factory_id?: string | null;
          from_tailor_id?: string | null;
          id?: string;
          material_unit_id: string;
          request_id: string;
          request_payload: Json;
          to_factory_id: string;
          to_tailor_id: string;
          transferred_at?: string;
          transferred_by: string;
        };
        Update: {
          from_factory_id?: string | null;
          from_tailor_id?: string | null;
          id?: string;
          material_unit_id?: string;
          request_id?: string;
          request_payload?: Json;
          to_factory_id?: string;
          to_tailor_id?: string;
          transferred_at?: string;
          transferred_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "material_unit_transfers_from_factory_id_fkey";
            columns: ["from_factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_factories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_unit_transfers_from_tailor_id_fkey";
            columns: ["from_tailor_id"];
            isOneToOne: false;
            referencedRelation: "tailors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_unit_transfers_material_unit_id_fkey";
            columns: ["material_unit_id"];
            isOneToOne: false;
            referencedRelation: "material_units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_unit_transfers_to_factory_id_fkey";
            columns: ["to_factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_factories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_unit_transfers_to_tailor_id_fkey";
            columns: ["to_tailor_id"];
            isOneToOne: false;
            referencedRelation: "tailors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_unit_transfers_transferred_by_fkey";
            columns: ["transferred_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      material_units: {
        Row: {
          allocated_expense_paise: number;
          assigned_factory_id: string | null;
          assigned_tailor_id: string | null;
          barcode: string;
          batch_id: string;
          cp_per_quantity_paise: number;
          direct_cost_paise: number;
          exhausted_at: string | null;
          id: string;
          initial_quantity: number;
          landed_cost_paise: number;
          material_id: string;
          net_purchase_paise: number;
          nonrecoverable_gst_paise: number;
          ordinal: number;
          received_at: string;
          received_by: string;
          recoverable_gst_paise: number;
          remaining_quantity: number;
          unit: string;
        };
        Insert: {
          allocated_expense_paise?: number;
          assigned_factory_id?: string | null;
          assigned_tailor_id?: string | null;
          barcode: string;
          batch_id: string;
          cp_per_quantity_paise: number;
          direct_cost_paise?: number;
          exhausted_at?: string | null;
          id?: string;
          initial_quantity: number;
          landed_cost_paise: number;
          material_id: string;
          net_purchase_paise: number;
          nonrecoverable_gst_paise?: number;
          ordinal: number;
          received_at?: string;
          received_by: string;
          recoverable_gst_paise?: number;
          remaining_quantity: number;
          unit: string;
        };
        Update: {
          allocated_expense_paise?: number;
          assigned_factory_id?: string | null;
          assigned_tailor_id?: string | null;
          barcode?: string;
          batch_id?: string;
          cp_per_quantity_paise?: number;
          direct_cost_paise?: number;
          exhausted_at?: string | null;
          id?: string;
          initial_quantity?: number;
          landed_cost_paise?: number;
          material_id?: string;
          net_purchase_paise?: number;
          nonrecoverable_gst_paise?: number;
          ordinal?: number;
          received_at?: string;
          received_by?: string;
          recoverable_gst_paise?: number;
          remaining_quantity?: number;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "material_units_assigned_factory_id_fkey";
            columns: ["assigned_factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_factories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_units_assigned_tailor_id_fkey";
            columns: ["assigned_tailor_id"];
            isOneToOne: false;
            referencedRelation: "tailors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_units_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "material_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_units_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "material_units_received_by_fkey";
            columns: ["received_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      materials: {
        Row: {
          active: boolean;
          category: string;
          cost_paise: number | null;
          id: string;
          name: string;
          price_paise: number | null;
          qty_on_hand: number;
          unit: string;
        };
        Insert: {
          active?: boolean;
          category?: string;
          cost_paise?: number | null;
          id?: string;
          name: string;
          price_paise?: number | null;
          qty_on_hand?: number;
          unit?: string;
        };
        Update: {
          active?: boolean;
          category?: string;
          cost_paise?: number | null;
          id?: string;
          name?: string;
          price_paise?: number | null;
          qty_on_hand?: number;
          unit?: string;
        };
        Relationships: [];
      };
      mixed_production_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          recorded_at: string;
          request_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          recorded_at?: string;
          request_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          production_job_id?: string;
          recorded_at?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mixed_production_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mixed_production_requests_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: true;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mixed_production_requests_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "production_batch_requests";
            referencedColumns: ["request_id"];
          },
        ];
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
        ];
      };
      order_item_financials: {
        Row: {
          cp_snapshot_paise: number | null;
          order_item_id: string;
          production_cost_snapshot_paise: number | null;
          recorded_at: string;
          tailoring_charge_snapshot_paise: number | null;
        };
        Insert: {
          cp_snapshot_paise?: number | null;
          order_item_id: string;
          production_cost_snapshot_paise?: number | null;
          recorded_at?: string;
          tailoring_charge_snapshot_paise?: number | null;
        };
        Update: {
          cp_snapshot_paise?: number | null;
          order_item_id?: string;
          production_cost_snapshot_paise?: number | null;
          recorded_at?: string;
          tailoring_charge_snapshot_paise?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "order_item_financials_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: true;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
      };
      order_items: {
        Row: {
          customer_tailoring_job_id: string | null;
          fabric_stock_id: string | null;
          final_customer_price_paise: number;
          finished_product_id: string | null;
          id: string;
          order_id: string;
          quantity: number;
          sp_snapshot_paise: number | null;
          thaan_id: string | null;
          unit: string;
        };
        Insert: {
          customer_tailoring_job_id?: string | null;
          fabric_stock_id?: string | null;
          final_customer_price_paise: number;
          finished_product_id?: string | null;
          id?: string;
          order_id: string;
          quantity: number;
          sp_snapshot_paise?: number | null;
          thaan_id?: string | null;
          unit: string;
        };
        Update: {
          customer_tailoring_job_id?: string | null;
          fabric_stock_id?: string | null;
          final_customer_price_paise?: number;
          finished_product_id?: string | null;
          id?: string;
          order_id?: string;
          quantity?: number;
          sp_snapshot_paise?: number | null;
          thaan_id?: string | null;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_items_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_items_thaan_id_fabric_stock_id_fkey";
            columns: ["thaan_id", "fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id", "fabric_stock_id"];
          },
        ];
      };
      orders: {
        Row: {
          code: string;
          completed_at: string | null;
          created_at: string;
          created_by: string | null;
          customer_id: string | null;
          customer_snapshot: Json | null;
          customer_tailoring_job_id: string | null;
          final_customer_price_paise: number | null;
          id: string;
          kind: string;
          legacy_sale_id: string | null;
          payment_confirmed_at: string | null;
          reference: string | null;
          sale_request_id: string | null;
          sale_request_payload: Json | null;
          salesperson_user_id: string | null;
          scan_code: string | null;
          source_location_id: string;
          status: string;
          tailoring_request_id: string | null;
        };
        Insert: {
          code: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          customer_snapshot?: Json | null;
          customer_tailoring_job_id?: string | null;
          final_customer_price_paise?: number | null;
          id?: string;
          kind: string;
          legacy_sale_id?: string | null;
          payment_confirmed_at?: string | null;
          reference?: string | null;
          sale_request_id?: string | null;
          sale_request_payload?: Json | null;
          salesperson_user_id?: string | null;
          scan_code?: string | null;
          source_location_id: string;
          status?: string;
          tailoring_request_id?: string | null;
        };
        Update: {
          code?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string | null;
          customer_id?: string | null;
          customer_snapshot?: Json | null;
          customer_tailoring_job_id?: string | null;
          final_customer_price_paise?: number | null;
          id?: string;
          kind?: string;
          legacy_sale_id?: string | null;
          payment_confirmed_at?: string | null;
          reference?: string | null;
          sale_request_id?: string | null;
          sale_request_payload?: Json | null;
          salesperson_user_id?: string | null;
          scan_code?: string | null;
          source_location_id?: string;
          status?: string;
          tailoring_request_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_customer_tailoring_job_id_fkey";
            columns: ["customer_tailoring_job_id"];
            isOneToOne: false;
            referencedRelation: "customer_tailoring_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_legacy_sale_id_fkey";
            columns: ["legacy_sale_id"];
            isOneToOne: true;
            referencedRelation: "sales";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_salesperson_user_id_fkey";
            columns: ["salesperson_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_source_location_id_fkey";
            columns: ["source_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      owner_definition_deletions: {
        Row: {
          actor_id: string;
          definition_id: string;
          kind: string;
          payload: Json;
          previous_value: Json;
          recorded_at: string;
          request_id: string;
        };
        Insert: {
          actor_id: string;
          definition_id: string;
          kind: string;
          payload: Json;
          previous_value: Json;
          recorded_at?: string;
          request_id: string;
        };
        Update: {
          actor_id?: string;
          definition_id?: string;
          kind?: string;
          payload?: Json;
          previous_value?: Json;
          recorded_at?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "owner_definition_deletions_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
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
      pos_terminals: {
        Row: {
          active: boolean;
          assigned_user_id: string | null;
          code: string;
          created_at: string;
          id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          assigned_user_id?: string | null;
          code: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          assigned_user_id?: string | null;
          code?: string;
          created_at?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "pos_terminals_assigned_user_id_fkey";
            columns: ["assigned_user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      production_batch_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          recorded_at: string;
          request_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          recorded_at?: string;
          request_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          production_job_id?: string;
          recorded_at?: string;
          request_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_batch_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_batch_requests_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: true;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_batch_requests_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "production_requests";
            referencedColumns: ["request_id"];
          },
        ];
      };
      production_completion_costs: {
        Row: {
          production_job_id: string;
          recorded_at: string;
          recorded_by: string;
          stitching_total_paise: number;
        };
        Insert: {
          production_job_id: string;
          recorded_at?: string;
          recorded_by: string;
          stitching_total_paise: number;
        };
        Update: {
          production_job_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          stitching_total_paise?: number;
        };
        Relationships: [
          {
            foreignKeyName: "production_completion_costs_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: true;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_completion_costs_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      production_cost_inputs: {
        Row: {
          consumable_receipt_id: string | null;
          cost_line_id: string;
          design_basis: string | null;
          quantity: number | null;
          unit: string | null;
        };
        Insert: {
          consumable_receipt_id?: string | null;
          cost_line_id: string;
          design_basis?: string | null;
          quantity?: number | null;
          unit?: string | null;
        };
        Update: {
          consumable_receipt_id?: string | null;
          cost_line_id?: string;
          design_basis?: string | null;
          quantity?: number | null;
          unit?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "production_cost_inputs_consumable_receipt_id_fkey";
            columns: ["consumable_receipt_id"];
            isOneToOne: false;
            referencedRelation: "consumable_receipts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cost_inputs_cost_line_id_fkey";
            columns: ["cost_line_id"];
            isOneToOne: true;
            referencedRelation: "production_cost_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      production_cost_lines: {
        Row: {
          amount_paise: number;
          category: string;
          cost_version_id: string;
          description: string | null;
          design_charge_version_id: string | null;
          fabric_cost_id: string | null;
          id: string;
          material_issue_line_id: string | null;
          recorded_at: string;
        };
        Insert: {
          amount_paise: number;
          category: string;
          cost_version_id: string;
          description?: string | null;
          design_charge_version_id?: string | null;
          fabric_cost_id?: string | null;
          id?: string;
          material_issue_line_id?: string | null;
          recorded_at?: string;
        };
        Update: {
          amount_paise?: number;
          category?: string;
          cost_version_id?: string;
          description?: string | null;
          design_charge_version_id?: string | null;
          fabric_cost_id?: string | null;
          id?: string;
          material_issue_line_id?: string | null;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_cost_lines_cost_version_id_fkey";
            columns: ["cost_version_id"];
            isOneToOne: false;
            referencedRelation: "production_cost_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cost_lines_design_charge_version_id_fkey";
            columns: ["design_charge_version_id"];
            isOneToOne: false;
            referencedRelation: "design_charge_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cost_lines_fabric_cost_id_fkey";
            columns: ["fabric_cost_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock_costs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cost_lines_material_issue_line_id_fkey";
            columns: ["material_issue_line_id"];
            isOneToOne: false;
            referencedRelation: "material_issue_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      production_cost_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          recorded_at: string;
          request_id: string;
          result_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          production_job_id: string;
          recorded_at?: string;
          request_id: string;
          result_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          production_job_id?: string;
          recorded_at?: string;
          request_id?: string;
          result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_cost_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cost_requests_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      production_cost_versions: {
        Row: {
          id: string;
          production_job_id: string;
          quantity_snapshot: number;
          reason: string | null;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
        };
        Insert: {
          id?: string;
          production_job_id: string;
          quantity_snapshot: number;
          reason?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
        };
        Update: {
          id?: string;
          production_job_id?: string;
          quantity_snapshot?: number;
          reason?: string | null;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "production_cost_versions_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_cost_versions_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      production_issue_fabric_costs: {
        Row: {
          amount_paise: number;
          cp_paise_per_m: number;
          fabric_cost_id: string;
          issue_line_id: string;
          recorded_at: string;
        };
        Insert: {
          amount_paise: number;
          cp_paise_per_m: number;
          fabric_cost_id: string;
          issue_line_id: string;
          recorded_at?: string;
        };
        Update: {
          amount_paise?: number;
          cp_paise_per_m?: number;
          fabric_cost_id?: string;
          issue_line_id?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_issue_fabric_costs_fabric_cost_id_fkey";
            columns: ["fabric_cost_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock_costs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_issue_fabric_costs_issue_line_id_fkey";
            columns: ["issue_line_id"];
            isOneToOne: true;
            referencedRelation: "material_issue_lines";
            referencedColumns: ["id"];
          },
        ];
      };
      production_job_tailors: {
        Row: {
          production_job_id: string;
          recorded_at: string;
          recorded_by: string;
          tailor_assignment_id: string;
        };
        Insert: {
          production_job_id: string;
          recorded_at?: string;
          recorded_by: string;
          tailor_assignment_id: string;
        };
        Update: {
          production_job_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          tailor_assignment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_job_tailors_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_job_tailors_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_job_tailors_tailor_assignment_id_fkey";
            columns: ["tailor_assignment_id"];
            isOneToOne: false;
            referencedRelation: "tailor_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      production_jobs: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          custom_design: string | null;
          design_charge_version_id: string | null;
          design_id: string | null;
          id: string;
          notes: string | null;
          product_id: string;
          quantity: number;
          scan_code: string | null;
          size: string | null;
          status: string;
          tailor_assignment_id: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          custom_design?: string | null;
          design_charge_version_id?: string | null;
          design_id?: string | null;
          id?: string;
          notes?: string | null;
          product_id: string;
          quantity: number;
          scan_code?: string | null;
          size?: string | null;
          status?: string;
          tailor_assignment_id: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          custom_design?: string | null;
          design_charge_version_id?: string | null;
          design_id?: string | null;
          id?: string;
          notes?: string | null;
          product_id?: string;
          quantity?: number;
          scan_code?: string | null;
          size?: string | null;
          status?: string;
          tailor_assignment_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_jobs_design_charge_version_id_design_id_fkey";
            columns: ["design_charge_version_id", "design_id"];
            isOneToOne: false;
            referencedRelation: "design_charge_versions";
            referencedColumns: ["id", "design_id"];
          },
          {
            foreignKeyName: "production_jobs_design_id_fkey";
            columns: ["design_id"];
            isOneToOne: false;
            referencedRelation: "designs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_jobs_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_jobs_tailor_assignment_id_fkey";
            columns: ["tailor_assignment_id"];
            isOneToOne: false;
            referencedRelation: "tailor_assignments";
            referencedColumns: ["id"];
          },
        ];
      };
      production_piece_specs: {
        Row: {
          custom_design: string | null;
          design_id: string | null;
          piece_number: number;
          product_id: string;
          production_job_id: string;
          recorded_at: string;
          recorded_by: string;
          size: string;
        };
        Insert: {
          custom_design?: string | null;
          design_id?: string | null;
          piece_number: number;
          product_id: string;
          production_job_id: string;
          recorded_at?: string;
          recorded_by: string;
          size: string;
        };
        Update: {
          custom_design?: string | null;
          design_id?: string | null;
          piece_number?: number;
          product_id?: string;
          production_job_id?: string;
          recorded_at?: string;
          recorded_by?: string;
          size?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_piece_specs_design_id_fkey";
            columns: ["design_id"];
            isOneToOne: false;
            referencedRelation: "designs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_piece_specs_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_piece_specs_production_job_id_fkey";
            columns: ["production_job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_piece_specs_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      production_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          recorded_at: string;
          request_id: string;
          result_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          recorded_at?: string;
          request_id: string;
          result_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          recorded_at?: string;
          request_id?: string;
          result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      production_status_events: {
        Row: {
          actor_id: string;
          id: string;
          job_id: string;
          previous_status: string;
          reason: string;
          recorded_at: string;
          request_id: string;
          status: string;
        };
        Insert: {
          actor_id: string;
          id?: string;
          job_id: string;
          previous_status: string;
          reason: string;
          recorded_at?: string;
          request_id: string;
          status: string;
        };
        Update: {
          actor_id?: string;
          id?: string;
          job_id?: string;
          previous_status?: string;
          reason?: string;
          recorded_at?: string;
          request_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "production_status_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_status_events_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "production_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "production_status_events_request_id_fkey";
            columns: ["request_id"];
            isOneToOne: true;
            referencedRelation: "production_requests";
            referencedColumns: ["request_id"];
          },
        ];
      };
      products: {
        Row: {
          active: boolean;
          code: string;
          id: string;
          name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          id?: string;
          name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          id?: string;
          name?: string;
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
          salesperson_code: string | null;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id: string;
          last_login?: string | null;
          salesperson_code?: string | null;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          email?: string | null;
          full_name?: string;
          id?: string;
          last_login?: string | null;
          salesperson_code?: string | null;
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
      return_credit_notes: {
        Row: {
          amount_paise: number;
          code: string;
          created_at: string;
          created_by: string;
          id: string;
          payment_method: string;
          return_id: string;
        };
        Insert: {
          amount_paise: number;
          code: string;
          created_at?: string;
          created_by: string;
          id?: string;
          payment_method: string;
          return_id: string;
        };
        Update: {
          amount_paise?: number;
          code?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          payment_method?: string;
          return_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "return_credit_notes_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "return_credit_notes_return_id_fkey";
            columns: ["return_id"];
            isOneToOne: true;
            referencedRelation: "defective_returns";
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
      sale_analysis_channels: {
        Row: {
          channel: string;
          external_reference: string | null;
          order_id: string;
          recorded_at: string;
        };
        Insert: {
          channel: string;
          external_reference?: string | null;
          order_id: string;
          recorded_at?: string;
        };
        Update: {
          channel?: string;
          external_reference?: string | null;
          order_id?: string;
          recorded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_analysis_channels_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_analysis_dimensions: {
        Row: {
          design_name: string | null;
          fabric_type: string | null;
          order_item_id: string;
          product_name: string | null;
          recorded_at: string;
          salesperson_name: string | null;
          size: string | null;
          vendor_id: string | null;
          vendor_name: string | null;
        };
        Insert: {
          design_name?: string | null;
          fabric_type?: string | null;
          order_item_id: string;
          product_name?: string | null;
          recorded_at?: string;
          salesperson_name?: string | null;
          size?: string | null;
          vendor_id?: string | null;
          vendor_name?: string | null;
        };
        Update: {
          design_name?: string | null;
          fabric_type?: string | null;
          order_item_id?: string;
          product_name?: string | null;
          recorded_at?: string;
          salesperson_name?: string | null;
          size?: string | null;
          vendor_id?: string | null;
          vendor_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sale_analysis_dimensions_order_item_id_fkey";
            columns: ["order_item_id"];
            isOneToOne: true;
            referencedRelation: "order_items";
            referencedColumns: ["id"];
          },
        ];
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
      stock_count_audits: {
        Row: {
          assigned_to: string;
          completed_at: string | null;
          created_at: string;
          created_by: string;
          id: string;
          item_kinds: string[];
          location_ids: string[];
          name: string;
          request_id: string;
          status: string;
        };
        Insert: {
          assigned_to: string;
          completed_at?: string | null;
          created_at?: string;
          created_by: string;
          id?: string;
          item_kinds: string[];
          location_ids: string[];
          name: string;
          request_id: string;
          status?: string;
        };
        Update: {
          assigned_to?: string;
          completed_at?: string | null;
          created_at?: string;
          created_by?: string;
          id?: string;
          item_kinds?: string[];
          location_ids?: string[];
          name?: string;
          request_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_count_audits_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_count_audits_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_count_items: {
        Row: {
          audit_id: string;
          barcode: string;
          details: Json;
          id: string;
          item_kind: string;
          location_id: string;
        };
        Insert: {
          audit_id: string;
          barcode: string;
          details: Json;
          id?: string;
          item_kind: string;
          location_id: string;
        };
        Update: {
          audit_id?: string;
          barcode?: string;
          details?: Json;
          id?: string;
          item_kind?: string;
          location_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_count_items_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "stock_count_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_count_items_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_count_scans: {
        Row: {
          audit_id: string;
          audit_item_id: string;
          scanned_at: string;
          scanned_by: string;
        };
        Insert: {
          audit_id: string;
          audit_item_id: string;
          scanned_at?: string;
          scanned_by: string;
        };
        Update: {
          audit_id?: string;
          audit_item_id?: string;
          scanned_at?: string;
          scanned_by?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_count_scans_audit_id_fkey";
            columns: ["audit_id"];
            isOneToOne: false;
            referencedRelation: "stock_count_audits";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_count_scans_audit_item_id_fkey";
            columns: ["audit_item_id"];
            isOneToOne: true;
            referencedRelation: "stock_count_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_count_scans_scanned_by_fkey";
            columns: ["scanned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_item_images: {
        Row: {
          created_at: string;
          created_by: string;
          item_id: string;
          item_kind: string;
          mime_type: string;
          storage_path: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          item_id: string;
          item_kind: string;
          mime_type: string;
          storage_path: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          item_id?: string;
          item_kind?: string;
          mime_type?: string;
          storage_path?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_item_images_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
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
      stock_registration_batches: {
        Row: {
          batch_id: string;
          created_at: string;
          created_by: string;
          provider_name: string;
          provider_prefix: string;
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          created_by: string;
          provider_name: string;
          provider_prefix: string;
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          created_by?: string;
          provider_name?: string;
          provider_prefix?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_registration_batches_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: true;
            referencedRelation: "receiving_batches";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_registration_batches_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_registration_fabric_types: {
        Row: {
          batch_id: string;
          code: string;
          created_at: string;
          created_by: string;
          id: string;
          label_position: number | null;
          name: string;
          next_ordinal: number;
        };
        Insert: {
          batch_id: string;
          code: string;
          created_at?: string;
          created_by: string;
          id?: string;
          label_position?: number | null;
          name: string;
          next_ordinal?: number;
        };
        Update: {
          batch_id?: string;
          code?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          label_position?: number | null;
          name?: string;
          next_ordinal?: number;
        };
        Relationships: [
          {
            foreignKeyName: "stock_registration_fabric_types_batch_id_fkey";
            columns: ["batch_id"];
            isOneToOne: false;
            referencedRelation: "stock_registration_batches";
            referencedColumns: ["batch_id"];
          },
          {
            foreignKeyName: "stock_registration_fabric_types_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_registration_requests: {
        Row: {
          action: string;
          actor_id: string;
          created_at: string;
          id: string | null;
          payload: Json;
          request_id: string;
          result_id: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          created_at?: string;
          id?: string | null;
          payload: Json;
          request_id: string;
          result_id: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          created_at?: string;
          id?: string | null;
          payload?: Json;
          request_id?: string;
          result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_registration_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_registration_variants: {
        Row: {
          code: string;
          created_at: string;
          created_by: string;
          details_recorded_at: string | null;
          draft_details: Json;
          fabric_stock_id: string;
          fabric_type_id: string;
          id: string;
          ordinal: number;
          thaan_id: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by: string;
          details_recorded_at?: string | null;
          draft_details?: Json;
          fabric_stock_id: string;
          fabric_type_id: string;
          id?: string;
          ordinal: number;
          thaan_id: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string;
          details_recorded_at?: string | null;
          draft_details?: Json;
          fabric_stock_id?: string;
          fabric_type_id?: string;
          id?: string;
          ordinal?: number;
          thaan_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_registration_variants_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_registration_variants_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: true;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_registration_variants_fabric_type_id_fkey";
            columns: ["fabric_type_id"];
            isOneToOne: false;
            referencedRelation: "stock_registration_fabric_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_registration_variants_thaan_id_fabric_stock_id_fkey";
            columns: ["thaan_id", "fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id", "fabric_stock_id"];
          },
          {
            foreignKeyName: "stock_registration_variants_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_registration_variants_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_registration_variants_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
      stock_transfer_lines: {
        Row: {
          fabric_stock_id: string | null;
          finished_product_id: string | null;
          id: string;
          material_id: string | null;
          quantity: number;
          thaan_id: string | null;
          transfer_id: string;
          unit: string;
        };
        Insert: {
          fabric_stock_id?: string | null;
          finished_product_id?: string | null;
          id?: string;
          material_id?: string | null;
          quantity: number;
          thaan_id?: string | null;
          transfer_id: string;
          unit: string;
        };
        Update: {
          fabric_stock_id?: string | null;
          finished_product_id?: string | null;
          id?: string;
          material_id?: string | null;
          quantity?: number;
          thaan_id?: string | null;
          transfer_id?: string;
          unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_fabric_stock_id_fkey";
            columns: ["fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_lines_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: false;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_lines_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfer_lines_thaan_id_fabric_stock_id_fkey";
            columns: ["thaan_id", "fabric_stock_id"];
            isOneToOne: false;
            referencedRelation: "thaans";
            referencedColumns: ["id", "fabric_stock_id"];
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey";
            columns: ["transfer_id"];
            isOneToOne: false;
            referencedRelation: "stock_transfers";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_transfers: {
        Row: {
          code: string;
          created_at: string;
          created_by: string | null;
          destination_location_id: string;
          id: string;
          posted_at: string | null;
          reason: string | null;
          request_id: string | null;
          request_payload: Json | null;
          source_location_id: string;
          status: string;
        };
        Insert: {
          code: string;
          created_at?: string;
          created_by?: string | null;
          destination_location_id: string;
          id?: string;
          posted_at?: string | null;
          reason?: string | null;
          request_id?: string | null;
          request_payload?: Json | null;
          source_location_id: string;
          status?: string;
        };
        Update: {
          code?: string;
          created_at?: string;
          created_by?: string | null;
          destination_location_id?: string;
          id?: string;
          posted_at?: string | null;
          reason?: string | null;
          request_id?: string | null;
          request_payload?: Json | null;
          source_location_id?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_transfers_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfers_destination_location_id_fkey";
            columns: ["destination_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_transfers_source_location_id_fkey";
            columns: ["source_location_id"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          address: string | null;
          city: string | null;
          email: string | null;
          gstin: string | null;
          id: string;
          name: string;
          phone: string | null;
        };
        Insert: {
          address?: string | null;
          city?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          name: string;
          phone?: string | null;
        };
        Update: {
          address?: string | null;
          city?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          name?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
      tailor_assignments: {
        Row: {
          factory_id: string;
          id: string;
          section_id: string | null;
          tailor_id: string;
          valid_from: string;
          valid_until: string | null;
        };
        Insert: {
          factory_id: string;
          id?: string;
          section_id?: string | null;
          tailor_id: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Update: {
          factory_id?: string;
          id?: string;
          section_id?: string | null;
          tailor_id?: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tailor_assignments_factory_id_fkey";
            columns: ["factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_factories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailor_assignments_section_id_factory_id_fkey";
            columns: ["section_id", "factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_sections";
            referencedColumns: ["id", "factory_id"];
          },
          {
            foreignKeyName: "tailor_assignments_tailor_id_fkey";
            columns: ["tailor_id"];
            isOneToOne: false;
            referencedRelation: "tailors";
            referencedColumns: ["id"];
          },
        ];
      };
      tailor_staff_assignments: {
        Row: {
          assigned_by: string;
          factory_id: string;
          id: string;
          staff_profile_id: string;
          tailor_id: string;
          valid_from: string;
          valid_until: string | null;
        };
        Insert: {
          assigned_by: string;
          factory_id: string;
          id?: string;
          staff_profile_id: string;
          tailor_id: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Update: {
          assigned_by?: string;
          factory_id?: string;
          id?: string;
          staff_profile_id?: string;
          tailor_id?: string;
          valid_from?: string;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tailor_staff_assignments_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailor_staff_assignments_factory_id_fkey";
            columns: ["factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_factories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailor_staff_assignments_staff_profile_id_fkey";
            columns: ["staff_profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailor_staff_assignments_tailor_id_fkey";
            columns: ["tailor_id"];
            isOneToOne: false;
            referencedRelation: "tailors";
            referencedColumns: ["id"];
          },
        ];
      };
      tailoring_charge_versions: {
        Row: {
          amount_paise: number;
          charge_id: string;
          id: string;
          recorded_at: string;
          recorded_by: string | null;
          revision: number;
        };
        Insert: {
          amount_paise: number;
          charge_id: string;
          id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision: number;
        };
        Update: {
          amount_paise?: number;
          charge_id?: string;
          id?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          revision?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tailoring_charge_versions_charge_id_fkey";
            columns: ["charge_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_charges";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "tailoring_charge_versions_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tailoring_charges: {
        Row: {
          active: boolean;
          code: string;
          id: string;
          name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          id?: string;
          name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      tailoring_factories: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          name?: string;
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
      tailoring_management_requests: {
        Row: {
          actor_id: string;
          payload: Json;
          recorded_at: string;
          request_id: string;
          result_id: string;
        };
        Insert: {
          actor_id: string;
          payload: Json;
          recorded_at?: string;
          request_id: string;
          result_id: string;
        };
        Update: {
          actor_id?: string;
          payload?: Json;
          recorded_at?: string;
          request_id?: string;
          result_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tailoring_management_requests_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      tailoring_sections: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          factory_id: string;
          id: string;
          name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          factory_id: string;
          id?: string;
          name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          factory_id?: string;
          id?: string;
          name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tailoring_sections_factory_id_fkey";
            columns: ["factory_id"];
            isOneToOne: false;
            referencedRelation: "tailoring_factories";
            referencedColumns: ["id"];
          },
        ];
      };
      tailors: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          id: string;
          profile_id: string | null;
          real_name: string;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          id?: string;
          profile_id?: string | null;
          real_name: string;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          id?: string;
          profile_id?: string | null;
          real_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tailors_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: true;
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
          barcode: string | null;
          batch_id: string | null;
          created_at: string;
          created_by: string | null;
          fabric_id: string | null;
          fabric_stock_id: string | null;
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
          barcode?: string | null;
          batch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          fabric_id?: string | null;
          fabric_stock_id?: string | null;
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
          barcode?: string | null;
          batch_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          fabric_id?: string | null;
          fabric_stock_id?: string | null;
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
          {
            foreignKeyName: "thaans_fabric_stock_fkey";
            columns: ["fabric_stock_id", "fabric_id", "batch_id"];
            isOneToOne: false;
            referencedRelation: "fabric_stock";
            referencedColumns: ["id", "fabric_id", "batch_id"];
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
            foreignKeyName: "permission_overrides_profile_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
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
            foreignKeyName: "user_roles_profile_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "user_roles_role_key_fkey";
            columns: ["role_key"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["key"];
          },
        ];
      };
      vendor_finished_product_receipt_pieces: {
        Row: {
          cp_paise: number;
          created_at: string;
          finished_product_id: string;
          receipt_id: string;
          size: string;
          vendor_style: string | null;
        };
        Insert: {
          cp_paise: number;
          created_at?: string;
          finished_product_id: string;
          receipt_id: string;
          size: string;
          vendor_style?: string | null;
        };
        Update: {
          cp_paise?: number;
          created_at?: string;
          finished_product_id?: string;
          receipt_id?: string;
          size?: string;
          vendor_style?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_finished_product_receipt_pieces_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: true;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendor_finished_product_receipt_pieces_receipt_id_fkey";
            columns: ["receipt_id"];
            isOneToOne: false;
            referencedRelation: "vendor_finished_product_receipts";
            referencedColumns: ["id"];
          },
        ];
      };
      vendor_finished_product_receipts: {
        Row: {
          arrival_date: string;
          code: string;
          created_at: string;
          created_by: string;
          id: string;
          payload: Json;
          remarks: string | null;
          request_id: string;
          supplier_name: string;
        };
        Insert: {
          arrival_date: string;
          code: string;
          created_at?: string;
          created_by: string;
          id?: string;
          payload: Json;
          remarks?: string | null;
          request_id: string;
          supplier_name: string;
        };
        Update: {
          arrival_date?: string;
          code?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          payload?: Json;
          remarks?: string | null;
          request_id?: string;
          supplier_name?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_finished_product_receipts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
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
      v_inventory_location_balances: {
        Row: {
          finished_product_id: string | null;
          inventory_item_id: string | null;
          location_id: string | null;
          material_id: string | null;
          quantity: number | null;
          thaan_id: string | null;
          unit: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_items_finished_product_id_fkey";
            columns: ["finished_product_id"];
            isOneToOne: true;
            referencedRelation: "finished_products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: true;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "thaans";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_overview";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_items_thaan_id_fkey";
            columns: ["thaan_id"];
            isOneToOne: true;
            referencedRelation: "v_thaan_stock";
            referencedColumns: ["thaan_id"];
          },
        ];
      };
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
        Insert: {
          available_mm?: never;
          held_mm?: never;
          thaan_id?: string | null;
        };
        Update: {
          available_mm?: never;
          held_mm?: never;
          thaan_id?: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      active_tailors: {
        Args: never;
        Returns: {
          email: string;
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
      append_registered_thans: {
        Args: { p_fabric_type: string; p_request: string; p_rows: Json };
        Returns: string;
      };
      apply_material_completion_cost: {
        Args: { p_job: string };
        Returns: undefined;
      };
      assign_tailor: {
        Args: {
          p_expected_assignment: string;
          p_factory: string;
          p_reason: string;
          p_request: string;
          p_section: string;
          p_tailor: string;
        };
        Returns: string;
      };
      assign_tailoring_job: {
        Args: { p_job_id: string; p_tailor_id: string };
        Returns: undefined;
      };
      barcode_base36_five: { Args: { p_number: number }; Returns: string };
      barcode_inspector_json: { Args: { p_value: Json }; Returns: Json };
      book_counter_tailoring: {
        Args: {
          p_assignment: string;
          p_customer: string;
          p_final_price: number;
          p_garment: string;
          p_items: Json;
          p_notes?: string;
          p_request: string;
          p_salesperson: string;
          p_source: string;
        };
        Returns: string;
      };
      book_invoice_tailoring: {
        Args: {
          p_assignment: string;
          p_customer: string;
          p_final_price: number;
          p_garment: string;
          p_items: Json;
          p_notes?: string;
          p_request: string;
          p_salesperson: string;
          p_source: string;
        };
        Returns: string;
      };
      book_invoice_tailoring_multi: {
        Args: {
          p_assignment: string;
          p_customer: string;
          p_final_price: number;
          p_garment: string;
          p_items: Json;
          p_notes?: string;
          p_request: string;
          p_salesperson: string;
        };
        Returns: string;
      };
      bootstrap_current_user: { Args: { _full_name?: string }; Returns: Json };
      business_sale_facts: {
        Args: { p_from?: string; p_location?: string; p_to?: string };
        Returns: {
          data: Json;
          event_at: string;
          row_key: string;
        }[];
      };
      business_sales_summary: {
        Args: { p_from: string; p_location?: string; p_to: string };
        Returns: Json;
      };
      can_change_others_thaan_cp: {
        Args: { p_creator: string };
        Returns: boolean;
      };
      can_edit_thaan_registration: {
        Args: { p_creator: string };
        Returns: boolean;
      };
      can_enter_legacy_cp: { Args: { p_thaan: string }; Returns: boolean };
      can_receive_fabric: { Args: never; Returns: boolean };
      can_view_thaan_cp: { Args: { p_creator: string }; Returns: boolean };
      capture_counter_print_record: {
        Args: { p_bill: string };
        Returns: undefined;
      };
      capture_production_fabric_cost: {
        Args: { p_line: string; p_quantity: number; p_stock: string };
        Returns: undefined;
      };
      commit_receiving_batch: { Args: { p_batch_id: string }; Returns: Json };
      complete_barcode_thaan: {
        Args: {
          p_barcode: string;
          p_colour: string;
          p_cp?: number;
          p_length_mm: number;
          p_request: string;
        };
        Returns: string;
      };
      complete_counter_bill: {
        Args: {
          p_contact?: string;
          p_customer?: string;
          p_items: Json;
          p_name?: string;
          p_paid: boolean;
          p_request: string;
          p_salesperson: string;
          p_source: string;
          p_tailoring: Json;
        };
        Returns: string;
      };
      complete_counter_bill_gst: {
        Args: {
          p_advance_paise: number;
          p_contact: string;
          p_items: Json;
          p_name: string;
          p_paid: boolean;
          p_request: string;
          p_salesperson: string;
          p_tailoring: Json;
          p_tax_context: Json;
        };
        Returns: string;
      };
      complete_counter_bill_gst_discount: {
        Args: {
          p_advance_paise: number;
          p_contact: string;
          p_discount_bps?: number;
          p_items: Json;
          p_name: string;
          p_paid: boolean;
          p_request: string;
          p_salesperson: string;
          p_tailoring: Json;
          p_tax_context: Json;
        };
        Returns: string;
      };
      complete_counter_bill_gst_discount_value: {
        Args: {
          p_advance_paise: number;
          p_birth_date: string;
          p_contact: string;
          p_discount_mode: string;
          p_discount_value: number;
          p_items: Json;
          p_name: string;
          p_paid: boolean;
          p_request: string;
          p_salesperson: string;
          p_tailoring: Json;
          p_tax_context: Json;
        };
        Returns: string;
      };
      complete_counter_bill_multi: {
        Args: {
          p_contact?: string;
          p_customer?: string;
          p_items: Json;
          p_name?: string;
          p_paid: boolean;
          p_request: string;
          p_salesperson: string;
          p_tailoring: Json;
        };
        Returns: string;
      };
      complete_counter_bill_multi_with_advance: {
        Args: {
          p_advance_paise: number;
          p_contact?: string;
          p_items: Json;
          p_name?: string;
          p_request: string;
          p_salesperson: string;
          p_tailoring: Json;
        };
        Returns: string;
      };
      complete_counter_bill_with_advance: {
        Args: {
          p_advance_paise: number;
          p_contact?: string;
          p_items: Json;
          p_name?: string;
          p_request: string;
          p_salesperson: string;
          p_source: string;
          p_tailoring: Json;
        };
        Returns: string;
      };
      complete_counter_fabric_sale:
        | {
            Args: {
              p_customer: string;
              p_items: Json;
              p_payment_confirmed: boolean;
              p_reference?: string;
              p_request_id: string;
              p_source: string;
            };
            Returns: string;
          }
        | {
            Args: {
              p_customer: string;
              p_items: Json;
              p_payment_confirmed: boolean;
              p_reference: string;
              p_request_id: string;
              p_salesperson: string;
              p_source: string;
            };
            Returns: string;
          };
      complete_direct_fabric_sale: {
        Args: {
          p_customer: string;
          p_items: Json;
          p_payment_confirmed: boolean;
          p_reference?: string;
          p_request_id: string;
          p_source: string;
        };
        Returns: string;
      };
      complete_fabric_entry: { Args: { p_stock: string }; Returns: string };
      complete_fabric_sale: {
        Args: { p_customer_id?: string; p_items: Json; p_reason?: string };
        Returns: Json;
      };
      complete_finished_product_exchange:
        | {
            Args: {
              p_original_bill: string;
              p_replacement_barcode: string;
              p_request: string;
              p_return_barcode: string;
              p_salesperson: string;
            };
            Returns: string;
          }
        | {
            Args: {
              p_original_bill: string;
              p_payment_method?: string;
              p_replacements: Json;
              p_request: string;
              p_returns: Json;
              p_salesperson: string;
            };
            Returns: string;
          };
      complete_finished_product_sale:
        | {
            Args: {
              p_customer: string;
              p_items: Json;
              p_payment_confirmed: boolean;
              p_reference?: string;
              p_request: string;
              p_source: string;
            };
            Returns: string;
          }
        | {
            Args: {
              p_customer: string;
              p_items: Json;
              p_payment_confirmed: boolean;
              p_reference: string;
              p_request: string;
              p_salesperson: string;
              p_source: string;
            };
            Returns: string;
          };
      complete_production_batch: {
        Args: {
          p_expected_status: string;
          p_job: string;
          p_reason: string;
          p_request: string;
        };
        Returns: string;
      };
      complete_production_batch_priced: {
        Args: {
          p_expected_status: string;
          p_job: string;
          p_prices: Json;
          p_reason: string;
          p_request: string;
        };
        Returns: string;
      };
      complete_stock_count_audit: {
        Args: { p_audit: string };
        Returns: undefined;
      };
      consumable_catalog: { Args: never; Returns: Json };
      consumable_receipt_history: { Args: { p_limit?: number }; Returns: Json };
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
      counter_bill: { Args: { p_code: string }; Returns: Json };
      counter_scan_barcode: {
        Args: { p_barcode: string; p_source: string };
        Returns: Json;
      };
      counter_scan_barcode_any: { Args: { p_barcode: string }; Returns: Json };
      create_barcode_batch: {
        Args: {
          p_arrival_date: string;
          p_fabrics: Json;
          p_provider: string;
          p_remarks: string;
          p_request: string;
        };
        Returns: string;
      };
      create_barcode_batch_with_details: {
        Args: {
          p_arrival_date: string;
          p_fabrics: Json;
          p_provider: string;
          p_remarks: string;
          p_request: string;
        };
        Returns: string;
      };
      create_barcode_batch_with_gst: {
        Args: {
          p_arrival_date: string;
          p_fabrics: Json;
          p_provider: string;
          p_purchase?: Json;
          p_remarks: string;
          p_request: string;
        };
        Returns: string;
      };
      create_barcode_batch_with_purchase_v2: {
        Args: {
          p_arrival_date: string;
          p_fabrics: Json;
          p_provider: string;
          p_purchase: Json;
          p_remarks: string;
          p_request: string;
        };
        Returns: string;
      };
      create_customer_tailoring: {
        Args: {
          p_assignment: string;
          p_customer: string;
          p_garment: string;
          p_notes?: string;
          p_quote: string;
          p_request: string;
        };
        Returns: string;
      };
      create_fabric_entry: {
        Args: {
          p_batch: string;
          p_cp: number;
          p_fabric: string;
          p_lengths: Json;
          p_request_id: string;
        };
        Returns: string;
      };
      create_mixed_production: {
        Args: {
          p_assignments: Json;
          p_items: Json;
          p_notes?: string;
          p_request: string;
          p_source: string;
          p_specs: Json;
        };
        Returns: string;
      };
      create_owner_production: {
        Args: {
          p_assignment: string;
          p_design: string;
          p_items: Json;
          p_notes: string;
          p_product: string;
          p_quantity: number;
          p_reason: string;
          p_request: string;
          p_source: string;
        };
        Returns: string;
      };
      create_owner_production_shared: {
        Args: {
          p_assignments: Json;
          p_design: string;
          p_items: Json;
          p_notes: string;
          p_product: string;
          p_quantity: number;
          p_reason: string;
          p_request: string;
          p_source: string;
        };
        Returns: string;
      };
      create_production_batch: {
        Args: {
          p_assignments: Json;
          p_custom_design: string;
          p_design: string;
          p_items: Json;
          p_notes: string;
          p_product: string;
          p_quantity: number;
          p_reason: string;
          p_request: string;
          p_size: string;
          p_source: string;
        };
        Returns: string;
      };
      create_stock_count_audit: {
        Args: {
          p_category_refs?: string[];
          p_kinds: string[];
          p_locations: string[];
          p_name: string;
          p_request: string;
          p_staff: string;
        };
        Returns: string;
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
      current_pos_terminal: { Args: never; Returns: Json };
      customer_job_fabric_cp: { Args: { p_job: string }; Returns: number };
      customer_tailoring_catalog: { Args: never; Returns: Json };
      customer_tailoring_final_price: {
        Args: { p_job_id: string };
        Returns: number;
      };
      customer_tailoring_finished_item: {
        Args: { p_code: string };
        Returns: Json;
      };
      customer_tailoring_history: {
        Args: { p_job?: string; p_limit?: number };
        Returns: Json;
      };
      customer_tailoring_work: { Args: { p_code?: string }; Returns: Json };
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
      dashboard_metrics: { Args: never; Returns: Json };
      definition_available: {
        Args: { p_id: string; p_kind: string };
        Returns: boolean;
      };
      direct_fabric_order_history: {
        Args: { p_limit?: number; p_order?: string };
        Returns: Json;
      };
      direct_fabric_sale_catalog: {
        Args: { p_barcode?: string };
        Returns: Json;
      };
      domain_stock_entry_cp: {
        Args: { p_cp?: number; p_stock_id: string };
        Returns: number;
      };
      ecommerce_listing_links: { Args: { p_listing: string }; Returns: Json };
      ecommerce_listing_stock: { Args: never; Returns: Json };
      ecommerce_scan_stock: { Args: { p_barcode: string }; Returns: Json };
      edit_workshop_thaan: {
        Args: {
          p_changes: Json;
          p_reason: string;
          p_request: string;
          p_thaan: string;
          p_version: string;
        };
        Returns: string;
      };
      eligible_tailoring_jobs: {
        Args: never;
        Returns: {
          code: string;
          garment: string;
          id: string;
          status: string;
          tailor_email: string;
          tailor_id: string;
          tailor_name: string;
        }[];
      };
      ensure_fabric: { Args: { p_name: string }; Returns: string };
      fabric_inventory_archive: { Args: never; Returns: Json };
      fabric_stock_catalog: { Args: { p_barcode?: string }; Returns: Json };
      fabric_stock_history: { Args: { p_stock: string }; Returns: Json };
      factory_transit_inventory: { Args: never; Returns: Json };
      fill_registered_thaan_cp: {
        Args: { p_barcode: string; p_cp: number; p_request: string };
        Returns: string;
      };
      finalize_production_cost: {
        Args: {
          p_design_basis: string;
          p_expected_version: string;
          p_job: string;
          p_materials: Json;
          p_other: Json;
          p_reason: string;
          p_request: string;
          p_tailoring: number;
        };
        Returns: string;
      };
      find_or_create_customer: {
        Args: {
          p_name?: string;
          p_notes?: string;
          p_phone?: string;
          p_whatsapp_phone?: string;
        };
        Returns: string;
      };
      finished_product_catalog: {
        Args: { p_barcode?: string; p_job?: string; p_limit?: number };
        Returns: Json;
      };
      finished_product_inventory: {
        Args: { p_after?: string; p_limit?: number };
        Returns: Json;
      };
      finished_product_movement_history: {
        Args: { p_limit?: number; p_piece?: string };
        Returns: Json;
      };
      finished_product_order_history: {
        Args: { p_limit?: number; p_order?: string };
        Returns: Json;
      };
      finished_product_sale_scan: { Args: { p_barcode: string }; Returns: Json };
      finished_product_transfer_scan: {
        Args: { p_barcode: string };
        Returns: Json;
      };
      gst_active_configuration: {
        Args: { p_at?: string };
        Returns: {
          address: string;
          contact: string;
          created_at: string;
          created_by: string;
          effective_from: string;
          enabled: boolean;
          gstin: string;
          id: string;
          invoice_display: string;
          legal_name: string;
          price_mode: string;
          purchase_mode: string;
          state_code: string;
          tailoring_display: string;
          trading_name: string;
        };
        SetofOptions: {
          from: "*";
          to: "gst_configuration_versions";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      gst_calculate_amount: {
        Args: {
          p_entered: number;
          p_mode: string;
          p_rate_bps: number;
          p_supply_type: string;
        };
        Returns: Json;
      };
      gst_discounted_garment_rate: {
        Args: { p_at?: string; p_unit_sp_paise: number };
        Returns: number;
      };
      gst_garment_slab_settings: { Args: never; Returns: Json };
      gst_invoice_document: { Args: { p_order: string }; Returns: Json };
      gst_rule_for: {
        Args: {
          p_category: string;
          p_configuration: string;
          p_item_ref?: string;
        };
        Returns: {
          category: string;
          classification_code: string;
          configuration_id: string;
          created_at: string;
          id: string;
          item_ref: string | null;
          label: string | null;
          rate_bps: number;
        };
        SetofOptions: {
          from: "*";
          to: "gst_tax_rules";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      gst_snapshot_counter_bill: {
        Args: { p_bill: string; p_context: Json };
        Returns: number;
      };
      gst_stage_counter_bill_multi: {
        Args: {
          p_contact?: string;
          p_customer?: string;
          p_items: Json;
          p_name?: string;
          p_paid: boolean;
          p_request: string;
          p_salesperson: string;
          p_tailoring: Json;
        };
        Returns: string;
      };
      gst_transaction_configuration: { Args: never; Returns: Json };
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
      inventory_balance: {
        Args: { p_item: string; p_location?: string };
        Returns: number;
      };
      inventory_catalog: {
        Args: never;
        Returns: {
          inventory_item_id: string;
          item_id: string;
          item_kind: string;
          label: string;
          quantity: number;
          unit: string;
          unlinked_movements: number;
        }[];
      };
      inventory_location_balances: {
        Args: never;
        Returns: {
          inventory_item_id: string;
          location_id: string;
          quantity: number;
          unit: string;
        }[];
      };
      inventory_locations: {
        Args: never;
        Returns: {
          active: boolean;
          code: string;
          id: string;
          kind: string;
          name: string;
          parent_id: string;
        }[];
      };
      inventory_movement_history: {
        Args: { p_limit?: number };
        Returns: {
          actor_id: string;
          customer_tailoring_job_id: string;
          destination_location_id: string;
          id: string;
          inventory_item_id: string;
          kind: string;
          occurred_at: string;
          order_item_id: string;
          production_job_id: string;
          quantity: number;
          reason: string;
          reference: string;
          source_location_id: string;
          stock_transfer_line_id: string;
          unit: string;
        }[];
      };
      is_active_staff: { Args: { _user_id: string }; Returns: boolean };
      is_showroom_location: { Args: { p_location: string }; Returns: boolean };
      issue_additional_customer_fabric: {
        Args: {
          p_barcode: string;
          p_job: string;
          p_quantity: number;
          p_request: string;
          p_source: string;
        };
        Returns: string;
      };
      issue_additional_production_fabric: {
        Args: {
          p_barcode: string;
          p_code: string;
          p_quantity_mm: number;
          p_reason: string;
          p_request: string;
          p_source: string;
        };
        Returns: string;
      };
      issue_tailoring_fabrics: {
        Args: { p_items: Json; p_job_id: string; p_reason?: string };
        Returns: Json;
      };
      job_workflow_stage: {
        Args: { p_job: string; p_kind: string };
        Returns: Json;
      };
      link_showroom_listing: {
        Args: {
          p_kind: string;
          p_link: boolean;
          p_listing: string;
          p_stock: string;
        };
        Returns: undefined;
      };
      listing_showroom_availability: {
        Args: never;
        Returns: {
          largest_piece_mm: number;
          linked_thaans: number;
          listing_id: string;
          total_linked_mm: number;
        }[];
      };
      log_audit: {
        Args: { _action: string; _detail: Json; _entity: string; _ref: string };
        Returns: undefined;
      };
      manage_consumable: {
        Args: {
          p_active: boolean;
          p_category: string;
          p_material: string;
          p_name: string;
        };
        Returns: undefined;
      };
      manage_production_catalog: {
        Args: {
          p_active: boolean;
          p_charge_paise: number;
          p_code: string;
          p_id: string;
          p_kind: string;
          p_name: string;
          p_reason: string;
          p_request: string;
        };
        Returns: string;
      };
      manage_showroom_location: {
        Args: {
          p_active?: boolean;
          p_code: string;
          p_id: string;
          p_name: string;
        };
        Returns: string;
      };
      manage_tailoring_entity: {
        Args: {
          p_active: boolean;
          p_code: string;
          p_factory?: string;
          p_id: string;
          p_kind: string;
          p_name: string;
          p_profile?: string;
          p_reason?: string;
          p_request: string;
        };
        Returns: string;
      };
      mark_counter_bill_paid: {
        Args: { p_bill: string; p_request: string };
        Returns: string;
      };
      material_available_qty: { Args: { p_material: string }; Returns: number };
      material_category_catalog: { Args: never; Returns: Json };
      material_consumption_history: {
        Args: { p_limit?: number };
        Returns: Json;
      };
      material_costs: {
        Args: never;
        Returns: {
          cost_paise: number;
          material_id: string;
        }[];
      };
      material_issue_history: {
        Args: { p_job?: string; p_limit?: number };
        Returns: Json;
      };
      material_issue_jobs: { Args: never; Returns: Json };
      material_transfer_destinations: { Args: never; Returns: Json };
      material_unit_catalog: { Args: { p_search?: string }; Returns: Json };
      new_finished_piece_barcode: { Args: never; Returns: string };
      new_material_unit_barcode: { Args: never; Returns: string };
      new_typed_finished_barcode: {
        Args: { p_prefix: string };
        Returns: string;
      };
      next_salesperson_code: { Args: never; Returns: string };
      next_six_barcode: { Args: { p_prefix: string }; Returns: string };
      ongoing_production_work: { Args: never; Returns: Json };
      open_fabric_cp_correction: {
        Args: { p_reason: string; p_stock: string };
        Returns: undefined;
      };
      owner_assign_factory_user: {
        Args: {
          p_expected?: string;
          p_factory: string;
          p_request: string;
          p_user: string;
        };
        Returns: string;
      };
      owner_assign_pos_terminal: {
        Args: { p_active?: boolean; p_terminal: string; p_user?: string };
        Returns: undefined;
      };
      owner_assign_tailor_staff: {
        Args: { p_staff: string; p_tailor: string };
        Returns: string;
      };
      owner_barcode_inspect: {
        Args: {
          p_barcode: string;
          p_before?: string;
          p_before_key?: string;
          p_limit?: number;
        };
        Returns: Json;
      };
      owner_create_pos_terminal: { Args: { p_code: string }; Returns: string };
      owner_customer_activity: {
        Args: never;
        Returns: {
          bill_count: number;
          customer_id: string;
          last_bill_at: string | null;
          open_tailoring_jobs: number;
          spend_paise: number;
          tailoring_jobs: number;
        }[];
      };
      owner_customer_tailoring_costs: { Args: { p_job: string }; Returns: Json };
      owner_daily_business: { Args: { p_day: string }; Returns: Json };
      owner_delete_definition: {
        Args: {
          p_expected_active: boolean;
          p_expected_name: string;
          p_id: string;
          p_kind: string;
          p_request: string;
        };
        Returns: string;
      };
      owner_delete_material_category: {
        Args: { p_id: string };
        Returns: undefined;
      };
      owner_delete_supplier_profile: {
        Args: { p_id: string };
        Returns: undefined;
      };
      owner_direct_fabric_order_costs: {
        Args: { p_order: string };
        Returns: Json;
      };
      owner_erp_overview: {
        Args: { p_from?: string; p_to?: string };
        Returns: Json;
      };
      owner_erp_report: {
        Args: {
          p_after?: string;
          p_dataset: string;
          p_from?: string;
          p_limit?: number;
          p_search?: string;
          p_to?: string;
        };
        Returns: Json;
      };
      owner_factory_users: { Args: never; Returns: Json };
      owner_gst_configuration: { Args: never; Returns: Json };
      owner_gst_report: {
        Args: {
          p_category?: string;
          p_from: string;
          p_location?: string;
          p_through: string;
        };
        Returns: Json;
      };
      owner_location_summary: { Args: never; Returns: Json };
      owner_material_category_catalog: { Args: never; Returns: Json };
      owner_monthly_business: {
        Args: {
          p_from: string;
          p_location?: string;
          p_previous_from: string;
          p_previous_to: string;
          p_to: string;
        };
        Returns: Json;
      };
      owner_pos_terminals: { Args: never; Returns: Json };
      owner_production_catalog: { Args: never; Returns: Json };
      owner_production_costs: { Args: { p_job: string }; Returns: Json };
      owner_production_history: {
        Args: { p_job?: string; p_limit?: number };
        Returns: Json;
      };
      owner_record_gst_adjustment: {
        Args: {
          p_amount_paise: number;
          p_effective_date: string;
          p_kind: string;
          p_reason: string;
          p_reference: string;
          p_request: string;
        };
        Returns: string;
      };
      owner_register_staff: {
        Args: { p_name: string; p_roles: string[]; p_user: string };
        Returns: undefined;
      };
      owner_rename_pos_terminal: {
        Args: { p_code: string; p_terminal: string };
        Returns: undefined;
      };
      owner_revise_counter_bill_discount: {
        Args: { p_bill: string; p_discount_bps: number };
        Returns: string;
      };
      owner_revise_counter_bill_discount_value: {
        Args: {
          p_bill: string;
          p_discount_mode: string;
          p_discount_value: number;
        };
        Returns: string;
      };
      owner_save_gst_configuration: {
        Args: { p_configuration: Json; p_request: string; p_rules: Json };
        Returns: string;
      };
      owner_save_gst_garment_slabs: {
        Args: {
          p_effective_from: string;
          p_higher_rate_bps: number;
          p_lower_rate_bps: number;
          p_threshold_paise: number;
        };
        Returns: string;
      };
      owner_save_material_category: {
        Args: {
          p_active: boolean;
          p_id: string;
          p_measurement_unit: string;
          p_name: string;
        };
        Returns: string;
      };
      owner_save_pos_terminal: {
        Args: { p_active?: boolean; p_code: string; p_user: string };
        Returns: string;
      };
      owner_save_supplier_profile: {
        Args: {
          p_address: string;
          p_email: string;
          p_gstin: string;
          p_id: string;
          p_name: string;
          p_phone: string;
        };
        Returns: string;
      };
      owner_set_fabric_sp: {
        Args: { p_reason: string; p_sp: number; p_stock: string };
        Returns: number;
      };
      owner_set_salesperson_code: {
        Args: { p_code: string; p_user: string };
        Returns: string;
      };
      owner_set_user_permission: {
        Args: { p_granted: boolean; p_permission: string; p_user: string };
        Returns: undefined;
      };
      owner_set_user_pos_terminal: {
        Args: { p_terminal?: string; p_user: string };
        Returns: undefined;
      };
      owner_stock_correction_lookup: { Args: { p_barcode: string }; Returns: Json };
      owner_supplier_profiles: { Args: never; Returns: Json };
      owner_tailoring_hierarchy: { Args: never; Returns: Json };
      owner_tailoring_line_prices: {
        Args: never;
        Returns: {
          line_id: string;
          price_snapshot_paise: number;
        }[];
      };
      owner_user_permission_state: { Args: { p_user: string }; Returns: Json };
      owns_production_job: { Args: { p_job: string }; Returns: boolean };
      owns_tailor_assignment: {
        Args: { p_assignment: string };
        Returns: boolean;
      };
      permission_role_restriction: {
        Args: { p_permission: string; p_user: string };
        Returns: string;
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
      pos_reserve_variants: { Args: { p_barcode: string }; Returns: Json };
      post_inventory_transfer: {
        Args: {
          p_destination: string;
          p_items: Json;
          p_reason: string;
          p_request_id: string;
          p_source: string;
        };
        Returns: string;
      };
      post_material_issue: {
        Args: {
          p_items: Json;
          p_job: string;
          p_job_kind: string;
          p_reason: string;
          p_request_id: string;
          p_source: string;
          p_type: string;
        };
        Returns: string;
      };
      production_fabric_catalog: { Args: { p_barcode?: string }; Returns: Json };
      production_fabric_projection: {
        Args: { p_barcode?: string };
        Returns: Json;
      };
      production_history_base: {
        Args: { p_job?: string; p_limit?: number };
        Returns: Json;
      };
      production_job_document: { Args: { p_code: string }; Returns: Json };
      production_piece_context: { Args: { p_piece: string }; Returns: Json };
      production_piece_summary: { Args: { p_job: string }; Returns: Json };
      production_specifications: { Args: { p_job: string }; Returns: Json };
      production_tailor_names: { Args: { p_job: string }; Returns: Json };
      progress_owner_production: {
        Args: {
          p_expected_status: string;
          p_job: string;
          p_reason: string;
          p_request: string;
          p_status: string;
        };
        Returns: string;
      };
      quote_customer_tailoring: {
        Args: { p_charge: string; p_items: Json; p_source: string };
        Returns: Json;
      };
      receive_consumable: {
        Args: {
          p_category: string;
          p_cp: number;
          p_location: string;
          p_material: string;
          p_name: string;
          p_quantity: number;
          p_reason: string;
          p_request_id: string;
          p_unit: string;
        };
        Returns: string;
      };
      receive_customer_tailoring_finished_item: {
        Args: {
          p_job: string;
          p_name: string;
          p_request: string;
          p_size: string;
          p_sp_paise: number;
        };
        Returns: Json;
      };
      receive_finished_products: {
        Args: {
          p_job: string;
          p_pieces: Json;
          p_reason: string;
          p_request: string;
        };
        Returns: string;
      };
      receive_material_unit_batch: {
        Args: {
          p_lines: Json;
          p_reference: string;
          p_request: string;
          p_shared_expense_paise: number;
          p_supplier: string;
        };
        Returns: string;
      };
      receive_material_unit_batch_with_purchase: {
        Args: {
          p_lines: Json;
          p_purchase: Json;
          p_reference: string;
          p_request: string;
          p_shared_expense_paise: number;
          p_supplier: string;
        };
        Returns: string;
      };
      receive_production_barcode: {
        Args: { p_code: string; p_request: string };
        Returns: string;
      };
      receive_production_barcode_priced: {
        Args: { p_code: string; p_prices: Json; p_request: string };
        Returns: string;
      };
      receive_vendor_finished_products: {
        Args: {
          p_arrival_date: string;
          p_items: Json;
          p_remarks: string;
          p_request: string;
          p_supplier: string;
        };
        Returns: Json;
      };
      receive_vendor_finished_products_with_purchase: {
        Args: {
          p_arrival_date: string;
          p_items: Json;
          p_purchase: Json;
          p_remarks: string;
          p_request: string;
          p_supplier: string;
        };
        Returns: Json;
      };
      reconcile_inventory_item: {
        Args: {
          p_allocations: Json;
          p_item_id: string;
          p_kind: string;
          p_reason: string;
        };
        Returns: string;
      };
      record_counter_bill_discount_revision: {
        Args: { p_bill: string; p_discount_bps: number };
        Returns: number;
      };
      record_counter_bill_fixed_discount_revision: {
        Args: { p_bill: string; p_discount_paise: number };
        Returns: number;
      };
      record_counter_bill_payment: {
        Args: { p_amount_paise: number; p_bill: string; p_request: string };
        Returns: string;
      };
      record_defective_return: {
        Args: {
          p_disposition: string;
          p_order_item: string;
          p_original_bill: string;
          p_payment_method?: string;
          p_quantity: number;
          p_reason: string;
          p_replacement_barcode?: string;
          p_request: string;
          p_resolution: string;
          p_salesperson?: string;
        };
        Returns: Json;
      };
      record_inventory_correction: {
        Args: {
          p_incoming: boolean;
          p_item: string;
          p_kind: string;
          p_location: string;
          p_quantity: number;
          p_reason: string;
        };
        Returns: string;
      };
      record_required_stock_purchase: {
        Args: {
          p_batch: string;
          p_material_batch: string;
          p_purchase: Json;
          p_supplier: string;
          p_vendor_receipt: string;
        };
        Returns: string;
      };
      register_delivery_batch: {
        Args: { p_provider: string; p_request: string };
        Returns: string;
      };
      register_fabric_type: {
        Args: {
          p_batch: string;
          p_name: string;
          p_request: string;
          p_rows: Json;
        };
        Returns: string;
      };
      registered_thaan_details: { Args: { p_barcode: string }; Returns: Json };
      registration_fill_cp_internal: {
        Args: { p_barcode: string; p_cp: number; p_request: string };
        Returns: string;
      };
      registration_insert_thans: {
        Args: { p_group: string; p_rows: Json };
        Returns: undefined;
      };
      registration_provider_prefix: {
        Args: { p_name: string };
        Returns: string;
      };
      registration_request_result: {
        Args: { p_action: string; p_payload: Json; p_request: string };
        Returns: string;
      };
      registration_variant_suffix: {
        Args: { p_ordinal: number };
        Returns: string;
      };
      release_hold: { Args: { p_hold_id: string }; Returns: undefined };
      require_salesperson: { Args: { p_user: string }; Returns: undefined };
      resolve_document_scan_code: { Args: { p_value: string }; Returns: string };
      resolve_finished_receipt: { Args: { p_code: string }; Returns: Json };
      reverse_job_material_consumption: {
        Args: { p_consumption: string; p_reason: string };
        Returns: undefined;
      };
      salesperson_options: { Args: never; Returns: Json };
      salesperson_work: {
        Args: {
          p_after?: string;
          p_after_id?: string;
          p_limit?: number;
          p_salesperson?: string;
        };
        Returns: Json;
      };
      save_customer_tailoring_completion_cost: {
        Args: { p_job: string; p_stitching_cp_paise: number };
        Returns: Json;
      };
      save_ecommerce_listing_details: {
        Args: { p_details: Json; p_listing: string; p_stock?: Json };
        Returns: undefined;
      };
      save_production_completion_cost: {
        Args: { p_job: string; p_stitching_total_paise: number };
        Returns: undefined;
      };
      save_registered_thaan_details: {
        Args: {
          p_barcode: string;
          p_colour?: string;
          p_cp?: number;
          p_length_mm?: number;
          p_request: string;
        };
        Returns: string;
      };
      save_stock_item_images: { Args: { p_links: Json }; Returns: number };
      set_customer_tailoring_charge: {
        Args: { p_amount: number; p_code: string; p_name: string };
        Returns: string;
      };
      set_customer_tailoring_status: {
        Args: { p_job: string; p_status: string };
        Returns: undefined;
      };
      set_finished_product_sp: {
        Args: {
          p_cost_version: string;
          p_job: string;
          p_reason: string;
          p_request: string;
          p_updates: Json;
        };
        Returns: string;
      };
      set_workshop_product_sp: {
        Args: {
          p_job: string;
          p_reason: string;
          p_request: string;
          p_updates: Json;
        };
        Returns: string;
      };
      setup_customer_tailoring_assignment: {
        Args: {
          p_factory_code: string;
          p_factory_name: string;
          p_profile?: string;
          p_section_code: string;
          p_section_name: string;
          p_tailor_code: string;
          p_tailor_name: string;
        };
        Returns: string;
      };
      showroom_fabric_available_total: { Args: never; Returns: number };
      showroom_floor_distribution: { Args: never; Returns: Json };
      showroom_stock: { Args: { p_kind?: string }; Returns: Json };
      showroom_stock_projection: { Args: { p_kind: string }; Returns: Json };
      stock_activity: {
        Args: {
          p_after?: string;
          p_after_id?: string;
          p_limit?: number;
          p_search?: string;
        };
        Returns: Json;
      };
      stock_count_my_task: { Args: never; Returns: Json };
      stock_count_owner_view: { Args: never; Returns: Json };
      stock_count_scan: {
        Args: { p_audit: string; p_barcode: string };
        Returns: Json;
      };
      stock_count_setup_catalog: { Args: never; Returns: Json };
      stock_entry_cp: { Args: { p_thaan_id: string }; Returns: number };
      stock_entry_set_cp: {
        Args: { p_cost_paise: number; p_thaan_id: string };
        Returns: undefined;
      };
      stock_registration_catalog: {
        Args: { p_barcode?: string; p_batch?: string };
        Returns: Json;
      };
      stock_transfer_history: {
        Args: { p_limit?: number; p_stock?: string };
        Returns: Json;
      };
      storefront_catalog: { Args: never; Returns: Json };
      submit_job_material_consumption: {
        Args: {
          p_job: string;
          p_job_kind: string;
          p_lines: Json;
          p_request: string;
          p_staff_assignment: string;
        };
        Returns: string;
      };
      submit_paid_ecommerce_order: {
        Args: {
          p_customer?: string;
          p_external_order: string;
          p_items: Json;
          p_paid_at: string;
          p_paid_total_paise: number;
          p_payment_reference: string;
          p_recorded_by: string;
          p_request: string;
          p_salesperson?: string;
        };
        Returns: string;
      };
      tailor_material_scan: { Args: { p_code: string }; Returns: Json };
      tailor_staff_work_summary: { Args: never; Returns: Json };
      tailor_work_order: { Args: { p_bill: string }; Returns: Json };
      tailoring_assignment_options: {
        Args: { p_factory?: string; p_no_section?: boolean; p_section?: string };
        Returns: Json;
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
      tailoring_work_catalog: { Args: never; Returns: Json };
      thaan_available_mm: { Args: { p_thaan: string }; Returns: number };
      transfer_finished_products: {
        Args: {
          p_destination: string;
          p_pieces: Json;
          p_reason: string;
          p_request: string;
          p_source: string;
        };
        Returns: string;
      };
      transfer_material_unit: {
        Args: { p_barcode: string; p_request: string; p_tailor: string };
        Returns: string;
      };
      update_account_name: { Args: { p_name: string }; Returns: undefined };
      update_fabric_entry: {
        Args: { p_cp: number; p_lengths: Json; p_stock: string };
        Returns: undefined;
      };
      update_tailoring_job_status: {
        Args: { p_job_id: string; p_status: string };
        Returns: undefined;
      };
      validate_production_piece_prices: {
        Args: { p_prices: Json; p_quantity?: number };
        Returns: Json;
      };
      vendor_finished_receiving_catalog: { Args: never; Returns: Json };
      vendor_readymade_stock: {
        Args: { p_limit?: number; p_search?: string };
        Returns: Json;
      };
      workshop_fabric_inventory: { Args: never; Returns: Json };
      workshop_production_pieces: { Args: { p_job: string }; Returns: Json };
      workshop_receipt_queue: { Args: never; Returns: Json };
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
