#!/bin/bash

echo -n "Creating folders... "

mkdir -p /app/config/keys
mkdir -p /app/data/secureconnection/.gnupg

echo " DONE"

echo -n "Copying over contents... "
cp -a /app/data/secureconnection/.gnupg /root/
echo " DONE"

echo "Encrypting file $3 for $1, signed by $2... "
gpg --sign --local-user $2 --recipient $1 --output /app/$4 --encrypt /app/$3
echo "DONE!"
echo ""
echo "Find your file in $4"
