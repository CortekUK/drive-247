-- Add DocuSign integration fields to rentals table

ALTER TABLE rentals
ADD COLUMN docusign_envelope_id TEXT,
ADD COLUMN document_status TEXT DEFAULT 'pending' CHECK (document_status IN ('pending', 'sent', 'delivered', 'signed', 'completed', 'declined', 'voided')),
ADD COLUMN signed_document_id UUID REFERENCES customer_documents(id),
ADD COLUMN envelope_created_at TIMESTAMPTZ,
ADD COLUMN envelope_sent_at TIMESTAMPTZ,
ADD COLUMN envelope_completed_at TIMESTAMPTZ;

-- Create index for faster lookups by envelope_id
CREATE INDEX idx_rentals_docusign_envelope_id ON rentals(docusign_envelope_id);

-- Create index for document status filtering
CREATE INDEX idx_rentals_document_status ON rentals(document_status);

-- Add comment
COMMENT ON COLUMN rentals.docusign_envelope_id IS 'DocuSign envelope ID for the rental agreement';
COMMENT ON COLUMN rentals.document_status IS 'Status of the DocuSign envelope: pending, sent, delivered, signed, completed, declined, voided';
COMMENT ON COLUMN rentals.signed_document_id IS 'Reference to the signed document in customer_documents table';
