#!/bin/bash

echo -n "Creating folders... "

mkdir -p /app/config/keys
mkdir -p /app/data/secureconnection/.gnupg

echo " DONE"

echo -n "Copying over contents... "
cp -a /app/data/secureconnection/.gnupg /root/
echo " DONE"

echo "Encrypting file $1 ... "
gpg --sign -local-user "secureproducer@redpencil.io" --output /app/$2 --encrypt /app/$1
echo "DONE!"
echo ""
echo "Find your file in $2"
