import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, Phone, Edit, MapPin, User } from "lucide-react";

interface NextOfKinCardProps {
  nokFullName?: string;
  nokRelationship?: string;
  nokPhone?: string;
  nokEmail?: string;
  nokAddress?: string;
  onEdit: () => void;
}

export const NextOfKinCard = ({
  nokFullName,
  nokRelationship,
  nokPhone,
  nokEmail,
  nokAddress,
  onEdit,
}: NextOfKinCardProps) => {
  const hasNextOfKin = nokFullName || nokRelationship || nokPhone || nokEmail || nokAddress;

  if (!hasNextOfKin) {
    return (
      <Card className="min-h-[140px] flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <User className="h-4 w-4 text-primary" />
            Emergency Contact
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-between">
          <p className="text-sm text-muted-foreground">No emergency contact information on file.</p>
          <Button variant="outline" size="sm" onClick={onEdit} className="self-start mt-3">
            <Edit className="h-3 w-3 mr-2" />
            Add Contact
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="min-h-[140px] flex flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm font-semibold">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Emergency Contact
          </div>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Edit className="h-3 w-3" />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        {nokFullName && (
          <div>
            <p className="font-semibold text-foreground">{nokFullName}</p>
            {nokRelationship && (
              <p className="text-xs text-muted-foreground">{nokRelationship}</p>
            )}
          </div>
        )}
        
        <div className="space-y-2">
          {nokPhone && (
            <a
              href={`tel:${nokPhone}`}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Phone className="h-3 w-3" />
              {nokPhone}
            </a>
          )}
          
          {nokEmail && (
            <a
              href={`mailto:${nokEmail}`}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors truncate"
            >
              <Mail className="h-3 w-3 flex-shrink-0" />
              <span className="truncate">{nokEmail}</span>
            </a>
          )}
          
          {nokAddress && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <div className="text-xs leading-relaxed">{nokAddress}</div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};