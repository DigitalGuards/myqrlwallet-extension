import { Button } from "@/components/UI/Button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/UI/Card";
import { useStore } from "@/stores/store";
import type { Contact } from "@/types/contact";
import { BookUser, Plus } from "lucide-react";
import { observer } from "mobx-react-lite";
import { useTranslation } from "react-i18next";
import { useEffect, useState } from "react";
import BackButton from "../../../Shared/BackButton/BackButton";
import CircuitBackground from "../../../Shared/CircuitBackground/CircuitBackground";
import ContactForm from "./ContactForm";
import ContactList from "./ContactList";

const ContactsPage = observer(() => {
  const { t } = useTranslation();
  const { contactsStore } = useStore();
  const { contacts } = contactsStore;

  const [showForm, setShowForm] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | undefined>();

  useEffect(() => {
    contactsStore.loadContacts();
  }, []);

  const handleAdd = () => {
    setEditingContact(undefined);
    setShowForm(true);
  };

  const handleEdit = (contact: Contact) => {
    setEditingContact(contact);
    setShowForm(true);
  };

  const handleDelete = async (address: string) => {
    await contactsStore.removeContact(address);
  };

  const handleSave = async (contact: Contact) => {
    if (editingContact) {
      await contactsStore.updateContact(editingContact.address, contact);
    } else {
      await contactsStore.addContact(contact);
    }
    setShowForm(false);
    setEditingContact(undefined);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingContact(undefined);
  };

  return (
    <div className="w-full">
      <CircuitBackground />
      <div className="page-enter relative z-10 p-8">
        <BackButton />
        <Card className="w-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <BookUser className="h-5 w-5" />
                {t('contacts.title')}
              </CardTitle>
              {!showForm && (
                <Button size="sm" variant="outline" onClick={handleAdd}>
                  <Plus className="mr-1 h-4 w-4" />
                  {t('contacts.addButton')}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {showForm ? (
              <ContactForm
                initialContact={editingContact}
                existingAddresses={contacts.map((c) => c.address)}
                onSave={handleSave}
                onCancel={handleCancel}
              />
            ) : (
              <ContactList
                contacts={contacts}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
});

export default ContactsPage;
