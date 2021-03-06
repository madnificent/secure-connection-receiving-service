#!/bin/bash

echo -n "Creating folders... "

mkdir -p /app/config/keys
mkdir -p /app/data/secureconnection/.gnupg

echo " DONE"

echo -n "Copying over contents... "
cp -a /app/data/secureconnection/.gnupg /root/
echo " DONE"

echo "Encrypting file $2 for $1... "
gpg --recipient $1 --output /app/$3 --encrypt /app/$2
echo "DONE!"
echo ""
echo "Find your file in $3"
