#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/aws-helpers.sh"

REGION="ap-southeast-2"
echo "== EventNexus AWS Provisioning — Region $REGION =="
echo "Account: $(aws sts get-caller-identity --query Account --output text --region $REGION)"

# Helper to find or create
get_vpc() {
  aws ec2 describe-vpcs --filters Name=tag:Name,Values=${TAG_PREFIX}-vpc --region $REGION --query "Vpcs[0].VpcId" --output text 2>/dev/null | grep -v None || echo ""
}
get_igw() {
  aws ec2 describe-internet-gateways --filters Name=tag:Name,Values=${TAG_PREFIX}-igw --region $REGION --query "InternetGateways[0].InternetGatewayId" --output text 2>/dev/null | grep -v None || echo ""
}
get_subnet() {
  local name=$1
  aws ec2 describe-subnets --filters Name=tag:Name,Values=$name --region $REGION --query "Subnets[0].SubnetId" --output text 2>/dev/null | grep -v None || echo ""
}
get_sg() {
  local name=$1
  aws ec2 describe-security-groups --filters Name=group-name,Values=$name Name=vpc-id,Values=$VPC_ID --region $REGION --query "SecurityGroups[0].GroupId" --output text 2>/dev/null | grep -v None || echo ""
}
get_rt() {
  aws ec2 describe-route-tables --filters Name=tag:Name,Values=${TAG_PREFIX}-public-rt --region $REGION --query "RouteTables[0].RouteTableId" --output text 2>/dev/null | grep -v None || echo ""
}

# 1) VPC
VPC_ID=$(get_vpc)
if [ -z "$VPC_ID" ]; then
  echo ">> Creating VPC $VPC_CIDR"
  VPC_ID=$(aws ec2 create-vpc --cidr-block $VPC_CIDR --region $REGION --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=${TAG_PREFIX}-vpc}]" --query "Vpc.VpcId" --output text)
  aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-hostnames --region $REGION
  aws ec2 modify-vpc-attribute --vpc-id $VPC_ID --enable-dns-support --region $REGION
  echo "   VPC_ID=$VPC_ID"
else
  echo ">> Reusing VPC $VPC_ID"
fi

# 2) IGW
IGW_ID=$(get_igw)
if [ -z "$IGW_ID" ]; then
  echo ">> Creating IGW"
  IGW_ID=$(aws ec2 create-internet-gateway --region $REGION --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=${TAG_PREFIX}-igw}]" --query "InternetGateway.InternetGatewayId" --output text)
  aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID --region $REGION
  echo "   IGW_ID=$IGW_ID"
else
  echo ">> Reusing IGW $IGW_ID"
  # ensure attached
  ATTACHED=$(aws ec2 describe-internet-gateways --internet-gateway-ids $IGW_ID --region $REGION --query "InternetGateways[0].Attachments[0].VpcId" --output text 2>/dev/null || echo "")
  if [ "$ATTACHED" == "None" ] || [ -z "$ATTACHED" ]; then
    aws ec2 attach-internet-gateway --internet-gateway-id $IGW_ID --vpc-id $VPC_ID --region $REGION || true
  fi
fi

# 3) Subnets
SUBNET_A_ID=$(get_subnet ${TAG_PREFIX}-public-1a)
if [ -z "$SUBNET_A_ID" ]; then
  echo ">> Creating subnet $SUBNET_A_CIDR in $AZ_A"
  SUBNET_A_ID=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block $SUBNET_A_CIDR --availability-zone $AZ_A --region $REGION --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${TAG_PREFIX}-public-1a}]" --query "Subnet.SubnetId" --output text)
  aws ec2 modify-subnet-attribute --subnet-id $SUBNET_A_ID --map-public-ip-on-launch --region $REGION
  echo "   SUBNET_A_ID=$SUBNET_A_ID"
else
  echo ">> Reusing subnet A $SUBNET_A_ID"
fi

SUBNET_B_ID=$(get_subnet ${TAG_PREFIX}-public-1b)
if [ -z "$SUBNET_B_ID" ]; then
  echo ">> Creating subnet $SUBNET_B_CIDR in $AZ_B"
  SUBNET_B_ID=$(aws ec2 create-subnet --vpc-id $VPC_ID --cidr-block $SUBNET_B_CIDR --availability-zone $AZ_B --region $REGION --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=${TAG_PREFIX}-public-1b}]" --query "Subnet.SubnetId" --output text)
  aws ec2 modify-subnet-attribute --subnet-id $SUBNET_B_ID --map-public-ip-on-launch --region $REGION
  echo "   SUBNET_B_ID=$SUBNET_B_ID"
else
  echo ">> Reusing subnet B $SUBNET_B_ID"
fi

# 4) Route Table
RT_ID=$(get_rt)
if [ -z "$RT_ID" ]; then
  echo ">> Creating public route table"
  RT_ID=$(aws ec2 create-route-table --vpc-id $VPC_ID --region $REGION --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=${TAG_PREFIX}-public-rt}]" --query "RouteTable.RouteTableId" --output text)
  aws ec2 create-route --route-table-id $RT_ID --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID --region $REGION
  echo "   RT_ID=$RT_ID"
else
  echo ">> Reusing RT $RT_ID"
  # ensure route exists
  HAS_ROUTE=$(aws ec2 describe-route-tables --route-table-ids $RT_ID --region $REGION --query "RouteTables[0].Routes[?DestinationCidrBlock=='0.0.0.0/0'].GatewayId" --output text 2>/dev/null || echo "")
  if [ -z "$HAS_ROUTE" ] || [ "$HAS_ROUTE" == "None" ]; then
    aws ec2 create-route --route-table-id $RT_ID --destination-cidr-block 0.0.0.0/0 --gateway-id $IGW_ID --region $REGION || true
  fi
fi

# Associate RT to subnets
for SUB in $SUBNET_A_ID $SUBNET_B_ID; do
  ASSOC=$(aws ec2 describe-route-tables --route-table-ids $RT_ID --region $REGION --query "RouteTables[0].Associations[?SubnetId=='$SUB'].RouteTableAssociationId" --output text 2>/dev/null | grep -v None || echo "")
  if [ -z "$ASSOC" ]; then
    echo ">> Associating RT $RT_ID to $SUB"
    aws ec2 associate-route-table --route-table-id $RT_ID --subnet-id $SUB --region $REGION >/dev/null
  else
    echo ">> RT $RT_ID already associated to $SUB ($ASSOC)"
  fi
done

# 5) Security Groups
SG_ALB_ID=$(get_sg $SG_ALB)
if [ -z "$SG_ALB_ID" ]; then
  echo ">> Creating SG $SG_ALB"
  SG_ALB_ID=$(aws ec2 create-security-group --group-name $SG_ALB --description "ALB SG for EventNexus" --vpc-id $VPC_ID --region $REGION --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_ALB}]" --query "GroupId" --output text)
  aws ec2 authorize-security-group-ingress --group-id $SG_ALB_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION
  aws ec2 authorize-security-group-ingress --group-id $SG_ALB_ID --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $REGION
  echo "   SG_ALB_ID=$SG_ALB_ID"
else
  echo ">> Reusing ALB SG $SG_ALB_ID"
fi

SG_EC2_ID=$(get_sg $SG_EC2)
if [ -z "$SG_EC2_ID" ]; then
  echo ">> Creating SG $SG_EC2"
  SG_EC2_ID=$(aws ec2 create-security-group --group-name $SG_EC2 --description "EC2 SG for EventNexus" --vpc-id $VPC_ID --region $REGION --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$SG_EC2}]" --query "GroupId" --output text)
  # SSH — restrict to operator IP in production; 0.0.0.0/0 kept for initial setup
  aws ec2 authorize-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port 22 --cidr 0.0.0.0/0 --region $REGION
  # Allow ALB -> EC2 on app ports (ALB is the only public entry point)
  aws ec2 authorize-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port 80 --source-group $SG_ALB_ID --region $REGION
  aws ec2 authorize-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port 3000 --source-group $SG_ALB_ID --region $REGION
  aws ec2 authorize-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port 5000 --source-group $SG_ALB_ID --region $REGION
  echo "   SG_EC2_ID=$SG_EC2_ID"
else
  echo ">> Reusing EC2 SG $SG_EC2_ID"
fi
# Ensure app ports are NOT world-open (remove if previously added)
for PORT in 3000 5000; do
  aws ec2 revoke-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port $PORT --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
done
# Ensure 80 world-open is only via ALB; direct 80 world-open removed unless operator explicitly needs it
aws ec2 revoke-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port 80 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
aws ec2 revoke-security-group-ingress --group-id $SG_EC2_ID --protocol tcp --port 443 --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true

# Allow EC2 egress all (default already)
echo ""
echo "== VPC Layer Complete =="
echo "VPC_ID=$VPC_ID"
echo "IGW_ID=$IGW_ID"
echo "SUBNET_A_ID=$SUBNET_A_ID ($AZ_A $SUBNET_A_CIDR)"
echo "SUBNET_B_ID=$SUBNET_B_ID ($AZ_B $SUBNET_B_CIDR)"
echo "RT_ID=$RT_ID"
echo "SG_ALB_ID=$SG_ALB_ID"
echo "SG_EC2_ID=$SG_EC2_ID"

# Persist for next steps
cat > infra/aws-ids.env <<EOF
VPC_ID=$VPC_ID
IGW_ID=$IGW_ID
SUBNET_A_ID=$SUBNET_A_ID
SUBNET_B_ID=$SUBNET_B_ID
RT_ID=$RT_ID
SG_ALB_ID=$SG_ALB_ID
SG_EC2_ID=$SG_EC2_ID
REGION=$REGION
EOF
cat infra/aws-ids.env

