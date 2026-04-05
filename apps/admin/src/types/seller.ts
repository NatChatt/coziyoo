export type SellerDetailTab = "general" | "foods" | "orders" | "wallet" | "identity" | "legal" | "security" | "reviews" | "complaints" | "notes" | "raw";

export type SellerSmartFilterKey =
  | "login_anomaly"
  | "pending_approvals"
  | "missing_documents"
  | "suspicious_logins"
  | "complaining_sellers"
  | "top_selling_foods"
  | "top_revenue"
  | "performance_drop"
  | "urgent_action"
  | "complainer_sellers";

export type SellerFoodRow = {
  id: string;
  name: string;
  code: string;
  categoryId: string | null;
  categoryName: string | null;
  cuisine: string | null;
  menuItems: Array<{
    name: string;
    categoryId?: string;
    categoryName?: string | null;
    kind?: "sauce" | "extra" | "appetizer";
    pricing?: "free" | "paid";
    price?: number;
  }>;
  secondaryCategories: Array<{ id: string; name: string }>;
  cardSummary: string | null;
  description: string | null;
  recipe: string | null;
  ingredients: string | null;
  allergens: string[];
  price: number;
  imageUrl: string | null;
  imageUrls: string[];
  status: "active" | "disabled";
  activeLotCount: number;
  onSaleQuantity: number;
  createdAt: string;
  updatedAt: string;
};

export type SellerAddressRow = {
  id: string;
  title: string;
  addressLine: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type SellerComplianceStatus = "not_started" | "in_progress" | "under_review" | "approved" | "rejected";
export type SellerComplianceDocumentStatus = "requested" | "uploaded" | "approved" | "rejected" | "expired";
export type OptionalUploadStatus = "uploaded" | "approved" | "rejected" | "archived" | "expired";

export type SellerCompliancePayload = {
  profile: {
    seller_id: string;
    status: SellerComplianceStatus;
    required_count: number;
    approved_required_count: number;
    uploaded_required_count: number;
    requested_required_count: number;
    rejected_required_count: number;
    review_notes: string | null;
    updated_at: string;
  };
  checks: Array<{
    id: string;
    check_code: string;
    required: boolean;
    status: string;
    value_json: unknown;
    updated_at: string;
  }>;
  documents: Array<{
    id: string;
    seller_id: string;
    document_list_id: string;
    code: string;
    name: string;
    description: string | null;
    source_info: string | null;
    details: string | null;
    validity_years: number | null;
    is_required: boolean;
    is_active: boolean;
    doc_type: string;
    file_url: string | null;
    status: SellerComplianceDocumentStatus;
    rejection_reason: string | null;
    notes: string | null;
    version: number;
    is_current: boolean;
    uploaded_at: string | null;
    expires_at: string | null;
    reviewed_at: string | null;
    updated_at: string;
  }>;
  profileDocuments: Array<{
    id: string;
    seller_id: string;
    doc_type: string;
    latest_document_id: string | null;
    status: SellerComplianceDocumentStatus;
    required: boolean;
    updated_at: string;
  }>;
  optionalUploads: Array<{
    id: string;
    seller_id: string;
    document_list_id: string | null;
    catalog_doc_code: string | null;
    catalog_doc_name: string | null;
    custom_title: string | null;
    custom_description: string | null;
    file_url: string;
    status: OptionalUploadStatus;
    reviewed_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    expires_at: string | null;
    updated_at: string;
  }>;
};

export type ComplianceRowKey =
  | "foodBusiness"
  | "taxPlate"
  | "kvkk"
  | "foodSafetyTraining"
  | "phoneVerification"
  | "workplaceInsurance";

export type ComplianceTone = "success" | "warning" | "danger" | "neutral";

export type ComplianceRowViewModel = {
  key: ComplianceRowKey;
  label: string;
  statusLabel: string;
  tone: ComplianceTone;
  detailText: string;
  isOptional?: boolean;
  sourceType: "document" | "check" | "fallback";
  sourceDocumentId?: string | null;
  sourceFileUrl?: string | null;
  sourceDocumentStatus?: SellerComplianceDocumentStatus | null;
  sourceRejectionReason?: string | null;
  sourceDate?: string | null;
};

export type ComplianceSource = {
  status: string | null;
  reviewedAt: string | null;
  uploadedAt: string | null;
  updatedAt: string | null;
  phoneValue?: string | null;
};
